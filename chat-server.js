// http://ejohn.org/blog/ecmascript-5-strict-mode-json-and-more/
"use strict";

// Optional. You will see this name in eg. 'ps' or 'top' command
process.title = 'node-chat';

// Port where we'll run the websocket server
var webSocketsServerPort = 1337;

// websocket and http servers
var webSocketServer = require('websocket').server;
var http = require('http');

var fs = require('fs');
var qs = require('querystring');

/**
 * Global variables
 */
// latest 100 messages
var history = [ ];
// list of currently connected clients (users)
var clients = [ ];

/**
 * Helper function for escaping input strings
 */
function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Array with some colors
var colors = [ 'red', 'green', 'blue', 'magenta', 'purple', 'plum', 'orange' ];
// ... in random order
colors.sort(function(a,b) { return Math.random() > 0.5; } );

var auth = {};
var sessions = {};

function makeSession(username, color) {
    var id = Math.random().toString().substring(2);
    sessions[id] = [username, color];
    return id;
}

/**
 * HTTP server
 */
var server = http.createServer(function(request, response) {
    function sendFile(fn) {
        fs.readFile(fn, 'utf8', function (err,data) {
            response.writeHead(200, {'Content-Type' : 'text/html'});
            response.write(data);
            response.end();
        });
    }
    function redirect(path, cookie) {
        response.writeHead(302, { Location: path, 'Set-Cookie': cookie === undefined ? '' : cookie });
        response.end();
    }
    switch(request.url.split('?')[0]) {
        case '/login':
            if(request.method == 'GET')
                sendFile('login.html');
            else {
                var body = '';
                request.on('data', function (data) {
                    body += data;
                });
                request.on('end', function () {
                    var post = qs.parse(body);
                    console.log('Login:', post);

                    if(auth[post.username] === undefined || (auth[post.username] !== undefined && auth[post.username][0] == post.password)) {
                        if(auth[post.username] === undefined) {
                            var userColor = colors.shift();
                            colors.push(userColor);
                            auth[post.username] = [post.password, makeSession(post.username, userColor)];
                        }
                        redirect('/chatgoat', 'sessid=' + auth[post.username][1]);
                    } else
                        redirect('/login?really?');
                });
            }
            break;
        case '/chatgoat':
            var sessid = request.headers.cookie ? request.headers.cookie.match(/sessid=([0-9]+)/) : undefined;
            if(!sessid || sessions[sessid[1]] === undefined) {
                redirect('/login');
                break;
            }
            sendFile('frontend.html');
            break;
        case '/chat-frontend.js':
            sendFile('chat-frontend.js');
            break;
        case '/jquery.js':
            sendFile('jquery.js');
            break;
        default:
            sendFile('404.html');
            break;
    }
});
server.listen(webSocketsServerPort, function() {
    console.log((new Date()) + " Server is listening on port " + webSocketsServerPort);
});

/**
 * WebSocket server
 */
var wsServer = new webSocketServer({
    // WebSocket server is tied to a HTTP server. WebSocket request is just
    // an enhanced HTTP request. For more info http://tools.ietf.org/html/rfc6455#page-6
    httpServer: server
});

// This callback function is called every time someone
// tries to connect to the WebSocket server
wsServer.on('request', function(request) {
    console.log((new Date()) + ' Connection from origin ' + request.origin + '.');

    var sessid = null;
    for(var elem of request.cookies)
        if(elem.name == 'sessid') {
            sessid = elem.value;
            break;
        }

    if(sessions[sessid] === undefined) {
        console.log('No session id or bad session id?');
        console.log(request.cookies);
        console.log(sessid);
        console.log(sessions[sessid]);
        return;
    }

    var connection = request.accept(null, request.origin); 
    var index = clients.push(connection) - 1;
    var userName = false;
    var userColor = false;

    var userName = sessions[sessid][0];
    var userColor = sessions[sessid][1];
    connection.sendUTF(JSON.stringify({ type:'init', data: [userName, userColor] }));
    console.log((new Date()) + ' User is known as: ' + userName
                + ' with ' + userColor + ' color.');

    // send back chat history
    if (history.length > 0) {
        connection.sendUTF(JSON.stringify( { type: 'history', data: history} ));
    }

    // user sent some message
    connection.on('message', function(message) {
        if (message.type === 'utf8') { // accept only text
            console.log((new Date()) + ' Received Message from '
                        + userName + ': ' + message.utf8Data);
            
            // we want to keep history of all sent messages
            var obj = {
                time: (new Date()).getTime(),
                text: htmlEntities(message.utf8Data),
                author: userName,
                color: userColor
            };
            history.push(obj);
            history = history.slice(-100);

            // broadcast message to all connected clients
            var json = JSON.stringify({ type:'message', data: obj });
            for (var i=0; i < clients.length; i++) {
                clients[i].sendUTF(json);
            }
        }
    });

    // user disconnected
    connection.on('close', function(connection) {
        if (userName !== false && userColor !== false) {
            console.log((new Date()) + " Peer "
                + connection.remoteAddress + " disconnected.");
            // remove user from the list of connected clients
            clients.splice(index, 1);
            // push back user's color to be reused by another user
            colors.push(userColor);
        }
    });

});