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
#Disable Typescript watch mode
RUN sed -i '/^[[:space:]]*"watch":/ s/:.*/: false/' tsconfig.json
#Needs a exit 0 because of build errors
RUN tsc; exit 0

WORKDIR /app/node_modules/@ekliptor/bit-models
#Disable Typescript watch mode
RUN sed -i '/^[[:space:]]*"watch":/ s/:.*/: false/' tsconfig.json
#Needs a exit 0 because of build errors
RUN tsc; exit 0

WORKDIR /app/node_modules/@ekliptor/browserutils
#Disable Typescript watch mode
RUN sed -i '/^[[:space:]]*"watch":/ s/:.*/: false/' tsconfig.json
RUN tsc

WORKDIR /app

#Disable Typescript watch mode
RUN sed -i '/^[[:space:]]*"watch":/ s/:.*/: false/' tsconfig.json
RUN tsc; exit 0

RUN chown -R node:node /app

USER node

WORKDIR /app/build

CMD [ "node", "app.js", "--debug", "--config=Noop" ,"--trader=RealTimeTrader" ,"--noUpdate" ,"--noBrowser" ]
