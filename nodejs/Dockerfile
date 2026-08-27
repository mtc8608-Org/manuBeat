FROM node:20

ARG UID=1000
ARG GID=1000

RUN uname=node && \
    oldid=$(id -u $uname) && \
    usermod -u "${UID}" $uname && \
    groupmod -g "${GID}" $uname && \
    find / -path /sys -prune -o -path /proc -prune -o \
      -group $oldid -exec chgrp -h $uname {} \; &&\
    find / -path /sys -prune -o -path /proc -prune -o \
      -user $oldid -exec chown -h $uname {} \;

# Set the working directory in the container
WORKDIR /src

# Dependency layer first so source edits don't invalidate the npm cache.
# npm ci installs exactly the committed lockfile and never rewrites it.
COPY package*.json ./
RUN npm ci

# Copy the rest of the application code to the container
COPY . .

RUN chmod +x ./entrypoint.sh
ENTRYPOINT [ "./entrypoint.sh" ]

# Define the command to run your app using CMD which defines your runtime
#CMD [ "node", "backend.js" ]