FROM node:12-slim

RUN set -x && \
  apt-get update && \
  apt-get install -y \
          build-essential \
          make \
          python

#Install Typescript
RUN npm install typescript@3.6.5 -g
ENV NODE_ENV=production

WORKDIR /app

COPY . .
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

RUN chown -R node:node /app

USER node

WORKDIR /app/build

CMD [ "node", "app.js", "--debug", "--config=Noop" ,"--trader=RealTimeTrader" ,"--noUpdate" ,"--noBrowser" ]
