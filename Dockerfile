FROM chr0n1x/docker-node-npm-bower-grunt:latest

ADD     . /app
WORKDIR /app

RUN npm install --production

ENTRYPOINT ["node", "/app/server.js"]
