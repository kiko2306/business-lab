FROM node:14.20-alpine

WORKDIR /app

RUN npm install nodemon -g

COPY package*.json ./
RUN npm install

CMD ["nodemon", "app.js"]