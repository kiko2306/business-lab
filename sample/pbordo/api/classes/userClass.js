module.exports = class User {

    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.access = [];
    }

    toString() {
        return JSON.stringify(this);
    }
} 