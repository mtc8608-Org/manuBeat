FROM node:20

ARG UID=1000
ARG GID=1000

RUN uname=node && \
    oldid=$(id -u $uname) && \
    usermod -u "${UID}" $uname && \
    groupmod -g "${GID}" $uname && \
    find / -path /sys -prune -o -path /proc -prune -o \
      -group $oldid -exec chgrp -h $uname {} \; && \
    find / -path /sys -prune -o -path /proc -prune -o \
      -user $oldid -exec chown -h $uname {} \;

RUN npm install -g @ionic/cli@7.0.1

WORKDIR /src

# Exec the bind-mounted entrypoint (like nodejs) so script edits take
# effect on restart — never bake a copy into the image.
ENTRYPOINT ["./entrypoint.sh"]
