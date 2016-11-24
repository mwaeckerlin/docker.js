# NodeJS Module for Handling and Displaying Docker Information

Manage docker containers in a web browser. Uses [GraphViz](https://github.com/mdaines/viz.js/) for rendering the docker containers from the server into a visible graph on the client's web browser.

This library will used in the project [Docker as a Service](https://servicedock.ch).

## Screen Shot

![Screen Shot of Docker Visualization](screenshot1.png)

## Server Side

Code snipped from usage on server side:

```javascript
var express = require('express');
var app = express.createServer();
var io = require('socket.io').listen(app);
var docker = require('docker.js')(app, io);
io.sockets.on('connection', docker.connect(socket));
```

## Client Side

Code snipped from usage on client side:

```html
<!DOCTYPE HTML>
<html>
  <head>
    <script type="text/javascript" src="/jquery.js"></script>
    <script type="text/javascript" src="/viz.js"></script>
    <script type="text/javascript" src="/docker.js"></script>
  </head>
  <body>
    <div id="main">… graphic goes here …</div>
  </body>
</html>
```
```javascript
var socket = null;
var docker = null;
function error(msg) {
  // handle display errors
}
function init() {
  socket = io.connect();
  docker = new Docker(socket, '#main', error);
}
$(init);
```