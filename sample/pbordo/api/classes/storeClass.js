const { v1: uuid } = require('uuid');

module.exports = class Store {
    constructor(name) {
        this.id = uuid();
        this.name = name;
        this.ip = '0.0.0.0';
        this.isActive = true;
    }

    toString() {
        return JSON.stringify(this);
    }
}