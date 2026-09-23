const router = require('express').Router();

const domainController = require('../controllers/domainController');

router.post('/user', (req, res, next) => {

    const { domain, username, password } = req.body;

    if (!domain || !username || !password) return res.status(401).send();

    console.log(domain, username, password);

    domainController.loginUser(domain, username, password).then(result => {
        if (result) return res.status(200).send();

        res.status(404).send();
    });
});

router.post('/domain', (req, res, next) => {

    const { domain, password } = req.body;

    if( !domain) return res.status(401).send();

    domainController.getDomain(domain).then(domain => {
        if(!domain) return res.status(404).send();

        if(!domain.password) return res.status(200).json(domain);

        if(domain.password === password) return res.status(200).json(domain);
        
        if(domain.password !== password) return res.status(401).json(domain);

    });

});

module.exports = router;