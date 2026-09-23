const fs = require('fs');
const path = require('path');

const request = require('request');

const util = require('util')
const requestPromise = util.promisify(request);

const dataDir = path.join(__dirname, '../data');
const Domain = require('../classes/domainClass');
const Store = require('../classes/storeClass');
const User = require('../classes/userClass');

/**
 * Adiciona um dominio novo
 * @param {string} name Nome do dominio a adicionar
 */
const addDomain = async (name) => {
    if (await isNew(name)) {
        const domain = new Domain(name);
        await fs.promises.writeFile(path.join(dataDir, name + '.json'), domain.toString());
        return true;
    } else {
        throw new Error('O dominio já existe!');
    }
}

/**
 * Carrega um dominio
 * @param {sring} name Nome do Dominio
 */
const getDomain = async (name) => {
    const exists = !await isNew(name);

    console.log(path.join(dataDir, name + '.json'));

    if (exists) {
        const domainData = await fs.promises.readFile(path.join(dataDir, name + '.json'), { encoding: 'utf-8' });
        const domain = Object.assign(new Domain(), JSON.parse(domainData));
        return domain;
    } else {
        return false;
    }
}

const updateDomain = async (domain) => {
    await fs.promises.writeFile(path.join(dataDir, domain.name + '.json'), domain.toString());
    return true;
}

/**
 * Apaga um dominio existente
 * @param {string} name Nome do Dominio a apagar
 */
const removeDomain = async (name) => {
    const exists = !await isNew(name);

    if (exists) {
        await fs.promises.unlink(path.join(dataDir, name + '.json'));
        return true;
    } else {
        throw new Error('O dominio não existe!');
    }
}

/**
 * Verifica se o dominio já existe
 * @param {string} name Nome do dominio
 */
const isNew = async (name) => {
    try {
        await fs.promises.stat(path.join(dataDir, name + '.json'));
        return false;
    } catch (error) {
        return true;
    }
}

const addStore = async (domainName, storeName) => {
    const domain = await getDomain(domainName);
    const store = domain.stores.find(s => s.name === storeName);

    if (!store) {
        domain.stores.push(new Store(storeName));

        await updateDomain(domain);

        return true;
    } else {
        throw new Error('A loja já existe!')
    }
}

const removeStore = async (domainName, storeName) => {
    const domain = await getDomain(domainName);
    const index = domain.stores.findIndex(s => s.name === storeName);


    if (index === -1) {
        throw new Error('A loja não existe!');
    } else {
        domain.stores.splice(index, 1);
        await updateDomain(domain);
        return true;
    }

}

const listStoresForUser = async (domainName, username) => {
    const domain = await getDomain(domainName);
    // console.log(domain.users[0].access);
    const user = domain.users.find(u => u.username === username);
    // console.log(user);

    const stores = [];

    for (let index = 0; index < user.access.length; index++) {
        const element = user.access[index];

        const store = domain.stores.find(s => s.id === element);

        // const isOnline = await checkStoreStatus(store);

        // if (isOnline) {
        //     store.isOnline = true;
        // } else {
        //     store.isOnline = false;
        // }

        if (store.isActive) {
            stores.push(store);
        }
    }

    return stores;
}

const checkStoreStatus = async (store) => {

    const url = 'http://' + store.ip + '/ping';

    try {
        const response = await requestPromise(url, { json: true });
        return response.body;

    } catch (error) {
        return false;
    }


}

const updateStoreIP = async (domainName, storeName, newIp) => {
    console.log('UpdateStoreIp');
    const domain = await getDomain(domainName);

    if (!domain) {
        console.log(`O dominio ${domainName} não existe!!!`);
        return false
    };

    const store = domain.stores.find(s => s.name === storeName);

    if (!store) {
        console.log(`O Loja ${store} não existe!!!`);
        return false;
    } else {
        console.log(`Ip actualizado com sucesso : ${domainName}/${storeName} -> ${newIp}`)
        store.ip = newIp;
        await updateDomain(domain);
        return true;
    }
}

const toogleStoreActiveStatus = async (domainName, storeName) => {
    const domain = await getDomain(domainName);
    const store = domain.stores.find(s => s.name === storeName);

    if (!store) {
        throw new Error('A loja não existe!');
    } else {
        store.isActive = !store.isActive;
        await updateDomain(domain);
        return true;
    }
}

const addUser = async (username, password, domainName) => {
    const domain = await getDomain(domainName);

    domain.users.push(new User(username, password));
    await updateDomain(domain);
    return true;
}

const removeUser = async (username, domainName) => {
    const domain = await getDomain(domainName);
    const userIndex = domain.users.findIndex(u => u.username === username);

    if (userIndex > -1) {
        domain.users.splice(userIndex, 1);
        await updateDomain(domain);
        return true;
    } else {
        return false;
    }

}

const loginUser = async (domainName, username, password) => {
    const domain = await getDomain(domainName);

    if (!domain) {
        console.log("Domain not found");
        return false;
    }

    const userIndex = domain.users.findIndex(u => u.username === username && u.password === password);

    if (userIndex > -1) {
        console.log("User found");
        return true;
    } else {
        console.log("User not found");
        return false;
    }
}

const addUserAccess = async (username, domainName, storeId) => {
    const domain = await getDomain(domainName);
    const user = domain.users.find(u => u.username === username);

    if (user) {
        user.access.push(storeId);
        await updateDomain(domain);
        return true;
    } else {
        return false;
    }
}

const removeUserAccess = async (username, domainName, storeId) => {
    const domain = await getDomain(domainName);
    const user = domain.users.find(u => u.username === username);

    if (user) {
        const sIdIndex = user.access.findIndex(a => a === storeId);

        user.access.splice(sIdIndex, 1);
        await updateDomain(domain);
        return true;
    } else {
        return false;
    }
}

const getOverview = async (domainName, storeId, cb) => {
    const domain = await getDomain(domainName);
    const store = domain.stores.find(s => s.id === storeId);

    const url = 'http://' + store.ip + '/overview';

    console.log(`Get overview ${url}`);

    request(url, { json: true }, (err, response, body) => {
        if (err) {
            console.log(err);
            cb(false)
        }

        console.log('Request finished');
        cb(body)
    });
}

const getSoldItems = async (domainName, storeId, cb) => {
    const domain = await getDomain(domainName);
    const store = domain.stores.find(s => s.id === storeId);

    const url = 'http://' + store.ip + '/sold_items';

    request(url, { json: true }, (err, response, body) => {
        if (err) { cb(false) }
        cb(body)
    });
}

const getTables = async (domainName, storeId, cb) => {
    const domain = await getDomain(domainName);
    const store = domain.stores.find(s => s.id === storeId);

    if (!domain || !store || !store.ip) return cb(false);

    const url = 'http://' + store.ip + '/tables';

    request(url, { json: true }, (err, response, body) => {
        if (err) { return cb(false) }
        cb(body)
    });
}

module.exports = {
    addDomain,
    removeDomain,
    getDomain,
    addStore,
    removeStore,
    updateStoreIP,
    toogleStoreActiveStatus,
    addUser,
    removeUser,
    addUserAccess,
    removeUserAccess,
    loginUser,
    listStoresForUser,
    getSoldItems,
    getTables,
    getOverview,
    checkStoreStatus
}