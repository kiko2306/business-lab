const router = require('express').Router()

/**
 * Check service status
 */
router.get('/', (req, res, next) => {
    console.log('Status')
    res.status(200).json({
        'status': 'Online',
    })
})

module.exports = router