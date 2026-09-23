FROM node:22-alpine
WORKDIR /app
COPY package.json experiment.json engine.js public-market.js paper.js research.test.js index.html ./
RUN node --test research.test.js
USER node
CMD ["node", "paper.js"]
