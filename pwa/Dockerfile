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

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /src

ENTRYPOINT ["/entrypoint.sh"]
