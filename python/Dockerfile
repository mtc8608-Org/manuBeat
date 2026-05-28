FROM python

ARG UID=1000
ARG GID=1000

RUN apt-get update && apt-get install -y --no-install-recommends hdf5-tools && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

WORKDIR /src
