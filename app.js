const cors = require('cors')
const expr = require('express')
const mysql = require('mysql')
const multer  = require("multer")
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const expressApp = expr()

expressApp.use(expr.json())
expressApp.use(expr.urlencoded({ extended:false }))
expressApp.use(cors())

const headers = {
    'Access-Control-Allow-Origin': '*',
}
const timestamp = 10 * 60 * 1000

expressApp.use((req, res, next) => {
    if (!res.headersSent)
        res.set(headers)
    next()
})

const storageConfig = multer.diskStorage({
    destination: (req, file, cb) =>{
        cb(null, "uploads")
    },
    filename: (req, file, cb) =>{
        cb(null, file.originalname)
    }
})

let tokenKey = Math.random().toString(36).slice(-8)

expressApp.use(["/file/*", "/info", "/logout"], (req, res, next) => {
    if (req.headers.authorization) {
        let tokenParts = req.headers.authorization
          .split(' ')[1]
          .split('.')
        let signature = crypto
          .createHmac('SHA256', tokenKey)
          .update(`${tokenParts[0]}.${tokenParts[1]}`)
          .digest('base64')
        
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf8'))
        if (signature === tokenParts[2] && new Date().getTime() <= payload.nbf) {
            next()
        }
        else {
            return res.status(403).send('Forbidden')
        }
    } else {
        return res.status(401).send('Not Authorized')
    }
})

expressApp.use(["/file/upload", "/file/update/:id"], multer({storage:storageConfig}).single("filedata"))

const port = process.env.PORT || process.argv[2] || 8080
const url = `http://localhost:${port}`
const uploadsUrl = './uploads'
const dbHandler = {
    host     : 'localhost',
    user     : 'root',
    database : 'rest_api',
    password : 'root'
}
let connection = {}
connection = mysql.createConnection(dbHandler)

function handleDisconnect() {
    connection = mysql.createConnection(dbHandler)

    connection.connect(function(err) {
        if(err) {
            console.log('error when connecting to db:', err)
            setTimeout(handleDisconnect, 2000)
        }
    })
    connection.on('error', function(err) {
        if(err.code === 'PROTOCOL_CONNECTION_LOST') {
            handleDisconnect()
        } else {
            throw err
        }
    })
}
handleDisconnect()

function authServer(req, res) {
    let data = [
        req.body.id,
        req.body.password
    ]
    let sql = `SELECT * FROM users WHERE id=? AND password=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            let head = Buffer.from(
                JSON.stringify({ alg: 'HS256', typ: 'jwt' })
            ).toString('base64')
            let body = Buffer.from(
                JSON.stringify({
                    id: data[0],
                    password: data[1],
                    nbf: new Date().getTime()+timestamp,
            })).toString('base64')

            let signature = crypto
            .createHmac('SHA256', tokenKey)
            .update(`${head}.${body}`)
            .digest('base64')

            const response = {
                accessToken: `${head}.${body}.${signature}`,
                refreshToken: Math.random().toString(36).slice(-8)
            }

            data = [
                response.refreshToken,
                rows[0].id
            ]
            sql = `UPDATE users SET refreshToken=? WHERE id=?`
            connection.query(sql, data, function(err, rows) {
                if (err) {
                    return console.error(err)
                }
                if (rows.changedRows) {
                    return
                }
            })
            return res.status(200).json(response)
        }
        return res.status(404).send('Not Found')
    })
}

function authRefresh(req, res) {
    tokenKey = Math.random().toString(36).slice(-8)
    const {refreshToken} = req.body

    let data = [
        refreshToken
    ]
    let sql = `SELECT * FROM users WHERE refreshToken=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            req.body.id = rows[0].id
            req.body.password = rows[0].password
            return authServer(req, res)
        }
        return res.status(404).send('Not Found')
    })
}

expressApp.post('/signin', authServer)

expressApp.post('/signin/new_token', authRefresh)

expressApp.post('/signup', function(req, res) {
    let data = [
        req.body.id,
        req.body.password
    ]

    let head = Buffer.from(
        JSON.stringify({ alg: 'HS256', typ: 'jwt' })
    ).toString('base64')

    let body = Buffer.from(
        JSON.stringify({id: data[0], password: data[1]})
    ).toString('base64')

    const secret = Math.random().toString(36).slice(-5)
    let signature = crypto
    .createHmac('SHA256', secret)
    .update(`${head}.${body}`)
    .digest('base64')

    let refreshToken = Math.random().toString(36).slice(-8)
    let accessToken = `${head}.${body}.${signature}`

    data.push(refreshToken)
    data.push(secret)

    sql = `INSERT INTO users (id, password, refreshToken, secret) VALUES (?, ?, ?, ?)`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        return res.status(200).json({
            refreshToken, accessToken
        })
    })
})

expressApp.get('/info', function(req, res) {
    const user = JSON.parse(Buffer.from(req.headers.authorization
        .split(' ')[1]
        .split('.')[1], 'base64').toString('utf8'))
    return res.json({id: user.id})    
})

expressApp.get('/logout', function(req, res) {
    authRefresh(req, res)   
})

expressApp.use("/file/upload", function(req, res, next) {
    let filedata = req.file
    let data = [
        filedata.originalname
    ]
    let sql = `SELECT id, name FROM files WHERE name=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            return res.send(`Такой файл уже существует, его id: ${rows[0].id}`)
        }
        next()
    })
})

expressApp.post("/file/upload", function(req, res) {
    let filedata = req.file
    data = [
        filedata.originalname, 
        filedata.originalname.split('.').pop(), 
        filedata.mimetype, 
        filedata.size,
        new Date()
    ]
    sql = `INSERT INTO files (name, extension, mime_type, size, date_downloaded) VALUES (?, ?, ?, ?, ?)`

    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (!res.headersSent)
            return res.send('Фалй загружен!')
    })
})

expressApp.use("/file/delete/:id", (req, res, next) => {
    const data = [
        req.params.id
    ]
    let sql = `SELECT name FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            return next()
        }
        return res.send("Такого файла нет!")
    })
})

expressApp.delete("/file/delete/:id", (req, res) => {
    const data = [
        req.params.id
    ]
    let name = ''
    let sql = `SELECT name FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            name = rows[0].name
        }
    })

    sql = `DELETE FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (!rows.message) {
            fs.unlinkSync(`${uploadsUrl}/${name}`)
            return res.send('Файл удален!')
        }
    })
})

expressApp.use("/file/update/:id", function(req, res, next) {
    const data = [
        req.params.id
    ]
    let sql = `SELECT name FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            fs.unlinkSync(`${uploadsUrl}/${rows[0].name}`)
            return next()
        }
        res.send(`Файла с id ${req.params.id} не существует`)
    })
})

expressApp.put("/file/update/:id", (req, res) => {
    let filedata = req.file
    
    const data = [
        filedata.originalname, 
        filedata.mimetype.split('/')[1], 
        filedata.mimetype, 
        filedata.size,
        new Date(),
        req.params.id
    ]
    let sql = `UPDATE files SET name=?, extension=?, mime_type=?, size=?, date_downloaded=? WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows.changedRows) {

            return res.send(`Файл с id: ${req.params.id} успешно обновлен!`)
        }
    })
})

expressApp.get("/file/download/:id", (req, res) => {
    const data = [
        req.params.id
    ]
    let sql = `SELECT name FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            return res.download(`${uploadsUrl}/${rows[0].name}`)
        }
        res.send(`Файла с id ${req.params.id} не существует`)
    })
})

expressApp.get("/file/list", (req, res) => {
    let paramsQuery = req.query

    if (!paramsQuery.list_size) {
        paramsQuery.list_size = 10
    }
    if (!paramsQuery.page) {
        paramsQuery.page = 1
    }

    const data = [
        (paramsQuery.page-1)*paramsQuery.list_size,
        +paramsQuery.list_size
    ]
    let sql = `SELECT * FROM files LIMIT ?, ?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (JSON.stringify(rows) != "[]" && !res.headersSent) {
            return res.send(rows)
        }
        if (!res.headersSent)
            return res.send(`Файлов на ${paramsQuery.page} странице нет.`)
    })
})

expressApp.get("/file/:id", (req, res) => {
    const data = [
        req.params.id
    ]
    let sql = `SELECT * FROM files WHERE id=?`
    connection.query(sql, data, function(err, rows) {
        if (err) {
            return console.error(err)
        }
        if (rows[0]) {
            return res.json(rows[0])
        }
        return res.send("Такого файла нет!")
    })
})

expressApp.listen(port, () => {
    console.log(`Server running at ${url}`)
})