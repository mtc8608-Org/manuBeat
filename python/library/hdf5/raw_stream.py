"""
Async streaming writer for the FULL raw-trace tensor of a population sweep.

The batched sweep produces, per saved run, a hyperslab block ``(chunkSamples, nDense, C)``
of signals. Holding the whole sweep — ``(N, T_total, C)`` ≈ tens of GB — in host RAM or
VRAM is impossible, so blocks are streamed straight to disk:

    producer (batch loop)  --submit(sampleStart, timeStart, block)-->  bounded Queue
                                                                          |
                                              single writer thread (owns the HDF5 handle)
                                              writes each block as a hyperslab into `raw`

Design notes:
  * Chunking the sample batch (done by the caller) bounds VRAM; streaming write-and-free
    bounds host RAM; this background thread overlaps the (slow, compressed) disk write with
    the next chunk's GPU compute, so the GPU does not stall on I/O.
  * A *thread* (not a process): h5py/HDF5 release the GIL during compressed writes, and the
    thread shares the numpy buffer with zero copy — a process would pay GB-scale pickling.
  * Bounded queue => backpressure: if the disk falls behind, the producer blocks instead of
    inflating RAM. A single writer owning the handle is the correct HDF5 concurrency model.
  * The `raw` dataset is HDF5-chunked at ``(1, nDense, C)`` so each submitted block aligns
    to chunk boundaries (no read-modify-write) and gzip-compresses each saved-run window.

Use as a context manager; ``init_population`` should have created the file + metadata first.
"""
from __future__ import annotations

import queue
import threading

import h5py as h5
import numpy as np

from . import engine


class RawTraceStreamWriter:
    def __init__(self, path, *, N, signalNames, totalPoints, nDense, time=None,
                 dtype="float32", compression="gzip", complevel=4, queueDepth=4,
                 group="raw"):
        self._path = path
        self._group = group
        self._C = len(signalNames)
        self._dtype = np.dtype(dtype)
        self._q: queue.Queue = queue.Queue(maxsize=queueDepth)
        self._err: Exception | None = None
        self._blocks = 0

        self._nDense = int(nDense)
        self._f = h5.File(path, "a")                       # init_population made the file
        for g in (group, f"{group}_coarse"):
            if g in self._f:
                del self._f[g]
        chunkT = max(1, min(int(nDense), int(totalPoints)))
        self._dset = self._f.create_dataset(
            group, shape=(int(N), int(totalPoints), self._C), dtype=self._dtype,
            chunks=(1, chunkT, self._C),
            compression=compression, compression_opts=complevel)
        self._dset.attrs["nDense"] = self._nDense          # so readers/builders know run length
        engine.write_str_array(self._f, f"{group}_signal_names", list(signalNames))
        if time is not None:
            self._f.create_dataset(f"{group}_time", data=np.asarray(time, dtype="float64"))

        # Coarse companion: ONE converged value per saved run (the run-end row). Tiny and
        # uncompressed, so the per-run convergence plot reads it instantly instead of
        # decompressing the full `raw` tensor. nRuns = totalPoints / nDense.
        self._nRuns = int(totalPoints) // self._nDense if self._nDense else 0
        self._coarse = self._f.create_dataset(
            f"{group}_coarse", shape=(int(N), self._nRuns, self._C), dtype=self._dtype)
        if time is not None and self._nRuns:
            t_arr = np.asarray(time, dtype="float64")
            self._f.create_dataset(f"{group}_coarse_time",
                                   data=t_arr[self._nDense - 1::self._nDense][:self._nRuns])

        self._thread = threading.Thread(target=self._run, name="RawTraceWriter", daemon=True)
        self._thread.start()

    def _run(self):
        while True:
            item = self._q.get()
            if item is None:
                self._q.task_done()
                break
            try:
                s, t, block = item
                cs, nt, _ = block.shape
                self._dset[s:s + cs, t:t + nt, :] = block      # hyperslab (gzip in C, GIL freed)
                if self._nRuns:                                # coarse: this run's end value
                    self._coarse[s:s + cs, t // self._nDense, :] = block[:, -1, :]
            except Exception as e:                              # noqa: BLE001 - surface to producer
                self._err = e
            finally:
                self._q.task_done()

    def submit(self, sampleStart, timeStart, block):
        """Enqueue a host block (chunkSamples, nDense, C). Raises if the writer thread has
        errored. The host copy (np.asarray of a device array) happens here on the producer;
        the slow compressed write happens on the writer thread."""
        if self._err is not None:
            raise self._err
        with np.errstate(over="ignore", invalid="ignore"):
            # diverged lanes blow up; in float32 that overflows to inf — expected (those runs
            # are masked elsewhere), so don't spam an overflow warning per block.
            host = np.asarray(block, dtype=self._dtype)
        self._q.put((int(sampleStart), int(timeStart), host))   # bounded queue => backpressure
        self._blocks += 1

    def close(self):
        self._q.put(None)
        self._q.join()
        self._thread.join()
        self._f.flush()
        self._f.close()
        if self._err is not None:
            raise self._err

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False
