const http = require('http')
const https = require('https')
const express = require('express')
const bodyParser = require('body-parser')
const fs = require('fs')
const cors = require('cors')

var privateKey = fs.readFileSync('certs/selfsigned.key', 'utf8')
var certificate = fs.readFileSync('certs/selfsigned.crt', 'utf8')

var credentials = { key: privateKey, cert: certificate }

require('dotenv').config()

const app = express()

app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

// app.use((req, res, next) => {
//     res.setHeader('Access-Control-Allow-Origin', '*');
//     res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
//     res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, POST, OPTIONS');
//     next();
// });

/**
 * Routes
 */
app.use('/status', require('./routes/statusRoute'))
app.use('/store', require('./routes/storeRoute'))
app.use('/login', require('./routes/loginRoute'))


/**
 * Start Server
 */
const startServer = () => {

    // Setup app folders
    require('./controllers/folderController').prepare()

    const httpServer = http.createServer(app)
    const port = process.env.PORT || 8080
    httpServer.listen(port)
    console.log(`The http server is running on port ${port}.`)

    // var httpsServer = https.createServer(credentials, app);
    // const https_port = process.env.HTTPS_PORT || 8084;
    // httpsServer.listen(https_port)
    // console.log(`The https server is running on port ${https_port}.`)

}

startServer()