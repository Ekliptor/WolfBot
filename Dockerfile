FROM node:12-slim

RUN set -x && \
  apt-get update && \
  apt-get install -y \
          build-essential \
          make \
          python

#Install Typescript
RUN npm install typescript@4.1.3 -g

WORKDIR /app

COPY . .
RUN chown -R node:node /app

# yarn and tsc shouldn't be run as root
USER node

# shouldn't be needed
ENV NODE_ENV=production

RUN yarn install

WORKDIR /app/node_modules/@ekliptor/apputils
#Needs a exit 0 because of build errors
RUN tsc --watch false; exit 0

WORKDIR /app/node_modules/@ekliptor/bit-models
#Needs a exit 0 because of build errors
RUN tsc --watch false; exit 0

WORKDIR /app/node_modules/@ekliptor/browserutils
RUN tsc --watch false

WORKDIR /app

RUN tsc --watch false; exit 0

WORKDIR /app/build

# let WolfBot know it's running in a VM
ENV WOLF_CONTAINER=docker

CMD [ "node", "app.js", "--debug", "--config=Noop" ,"--trader=RealTimeTrader" ,"--noUpdate" ,"--noBrowser" ]
