const router = require('express').Router();



const domainController = require('../controllers/domainController');

router.get('/', (req, res) => {
    res.status(200).json({
        'ola': 'mundo'
    });
});

router.get('/:n1/:n2', (req, res) => {
    res.status(200).json({
        'result': req.params.n1 + " " + req.params.n2
    });
});

router.post('/set_ip', async (req, res, next) => {

    console.log('A actualizar IP', req.body);

    const { store, domain, ip } = req.body;

    domainController.updateStoreIP(domain, store, ip)
        .then(result => {
            res.status(200).json({ message: 'Ip actualizado com sucesso' });
        })
});

router.get('/:domain/:store/overview', (req, res, next) => {
    const domain = req.params.domain;
    const storeId = req.params.store;

    domainController.getOverview(domain, storeId, (result) => {
        if (!result) {
            console.log('Overview not found');
            return res.status(404).send();
        }

        res.status(200).json(result);

    });
})

router.get('/:domain/:user/list', (req, res, next) => {
    const domain = req.params.domain;
    const user = req.params.user;

    domainController.listStoresForUser(domain, user).then(list => {
        res.status(200).json(list);
    });
})

router.get('/:domain/:store/sold_items', (req, res, next) => {

    const domain = req.params.domain;
    const storeId = req.params.store;

    domainController.getSoldItems(domain, storeId, (result) => {
        res.status(200).json(result);
    });
});


router.get('/:domain/:store/tables', (req, res, next) => {

    const domain = req.params.domain;
    const storeId = req.params.store;

    domainController.getTables(domain, storeId, (result) => {
        res.status(200).json(result);
    });
});

module.exports = router;