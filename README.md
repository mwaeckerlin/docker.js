NodeJS Module for Handling and Displaying Docker Information
============================================================

Manage docker containers in a web browser. Uses [GraphViz](https://github.com/mdaines/viz.js/) for rendering the docker containers from the server into a visible graph on the client's web browser.

This library will used in the project [Docker as a Service](https://servicedock.ch).

Screen Shot
-----------

![Screen Shot of Docker Visualization](screenshot1.png)

Server Side
-----------

Code snipped from usage on server side:

```javascript
var express = require('express')
var app = express()
var server = app.listen(3000, () => {
  // listening on port 3000
})
var io = require('socket.io').listen(server)
var docker = require('docker.js')(app, io)
io.sockets.on('connection', docker.connect)
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
    <script type="text/javascript" src="/socket.io.js"></script>
    <script type="text/javascript" src="/client.js"></script>
  </head>
  <body>
    <div id="stacks">… graphic goes here …</div>
    <a id="svgStacks></a>
    <footer>
        <div id="error">
    </footer>
  </body>
</html>
```

In `client.js`:
```javascript
var socket = null;
var docker = null;

function error(msg, data) {
  $('#error').html('<h1>Error</h1><p>'+(new Date()).toLocaleString()+'</p><p>'+msg+'</p><pre>'+data+'</pre>').show()
}

function sigstack() {
  $('#error').hide()
  var dot = docker.graphics.stack()
  var svg = docker.graphics.viz(dot, error)
  $('#stacks').html(svg)
  $('a#svgStacks').attr('href', 'data:image/svg;base64,'+btoa(svg))
                  .attr('target', '_blank')
                  .attr('download', window.location.hostname+'.svg')
                  .show()
}

function init() {
  socket = io.connect()
  docker = new Docker(socket, error, sigstack)
}
$(init)
```
