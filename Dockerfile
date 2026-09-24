FROM node:22-alpine
WORKDIR /app
COPY package.json experiment.json engine.js public-market.js market-strategy.js paper.js research.test.js paper-auto.test.js index.html ./
RUN npm test
USER node
CMD ["node", "paper.js"]
