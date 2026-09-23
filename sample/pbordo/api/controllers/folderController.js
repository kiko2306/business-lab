/**
 * Verifica a existencia das pastas necessarias á aplicação
 * Caso não existam cria-as
 */

const fs = require('fs');
const path = require('path');

const dirs = [
    "data"
]

const prepare = () => {
    dirs.forEach(dir => {
        fs.stat(dir, (err, stats) => {
            if (!stats) {
                fs.mkdir(dir, (err) => {
                    if (err) console.log(err);
                });
            }
        });
    });
}

module.exports = {
    prepare
}