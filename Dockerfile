FROM node:20-alpine

RUN apk add --no-cache python3 make g++ pkgconfig build-base linux-headers

RUN mkdir -p /opt/app && \
    mkdir -p /data/db && \
    mkdir -p /usr/lib/node_modules

# Copy projects folder into container's app folder
COPY . /opt/app

RUN chown -R node:node /opt/app/

# Change to app directory
WORKDIR /opt/app

# Enable debugging and app ports
EXPOSE 9200
EXPOSE 3000

# Dont run as root
USER node

RUN yarn
RUN yarn build

CMD [ "yarn", "start:dev" ]
