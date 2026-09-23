module.exports = class Domain {

    constructor(name) {
        this.name = name;
        this.stores = [];
        this.users = [];
    }

    toString() {
        return JSON.stringify(this);
    }
}