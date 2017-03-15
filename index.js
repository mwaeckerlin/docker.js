module.exports = function(app, io, updateContainerInterval, updateStatsInterval) {

  var running="";
  var proc = require('child_process');
  
  this.connect = function(socket) {

    var pty = require('pty.js');
    var docker = require(__dirname+'/docker.js');
    
    function emit(signal, data, info) {
      if (typeof data == 'string' && !data.match("\n")) {
        console.log("<- signal: "+signal+"("+data+")");
      } else {
        console.log("<- signal: "+signal);
      }
      if (info) console.log(info);
      socket.emit(signal, data);
    }

    function fail(txt, data) {
      console.log("** "+txt, data);
      emit("docker.fail", txt);
    }

    function modify(cmd, name) {
      if (!name.match(/^[a-z0-9][-_:.+a-z0-9]*$/i))
        return this.fail("illegal instance name");
      exec("docker "+cmd+" "+name, updatecontainers);
    }

    function createContainer(cmds) {
      if (cmds.length>0)
        exec(cmds.shift(), function(error, stdout, stderr) {
          if (error || stderr)
            return this.fail("create container failed", {
              error: error, stderr: stderr, stdout: stdout
            });
          createContainer(cmds);
        })
      else
        updatecontainers();
    }

    function containers() {
      console.log("-> containers");
      if (oldcontainer) emit("docker.containers", oldcontainer);
      else updatecontainers();
    }
    
    function images() {
      console.log("-> images");
      if (oldimage) emit("docker.images", oldimage);
      else updateimages();
    }
    
    function start(name) {
      console.log("-> start("+name+")");
      modify("start", name);
    }

    function stop(name) {
      console.log("-> stop("+name+")");
      modify("stop", name);
    }

    function pause(name) {
      console.log("-> pause("+name+")");
      modify("pause", name);
    }

    function unpause(name) {
      console.log("-> unpause("+name+")");
      modify("unpause", name);
    }

    function remove(name) {
      console.log("-> remove("+name+")");
      modify("rm", name);
    }

    function create(data) {
      console.log("-> create");
      var d = new docker.Docker();
      var dc = new d.Containers();
      createContainer(dc.creation(data));
    }

    function logs(name) {
      console.log("-> logs("+name+")");
      var l = proc.spawn("docker", ["logs", "-f", name])
                  .on('close', function(code) {
                    emit('docker.container.logs', {name: name, type: 'done'});
                  });
      l.stdout.on('data', function(data) {
        emit('docker.container.logs', {name: name, type: 'stdout', text: data.toString()});
      });
    }

    var bash_connections = {};

    function new_bash(name) {
      if (!name.match(/^[a-z0-9][-_:.+a-z0-9]*$/i))
        return this.fail("illegal instance name");
      if (bash_connections[name]) return;
      bash_connections[name] = pty.spawn("docker", ["exec", "-it", name, "bash", "-i"]);
      bash_connections[name].stdout.on('data', function(data) {
        emit('docker.container.bash.data', {name: name, type: 'stdout', text: data.toString()});
      });
    }

    function bash_start(name) {
      console.log("-> bash-start("+name+")");
      new_bash(name);
    }
    
    function bash_input(data) {
      console.log("-> bash-input("+data.name+", "+data.text+")");
      new_bash(data.name);
      bash_connections[data.name].stdin.resume();
      bash_connections[data.name].stdin.write(data.text);
    }

    function bash_end(name, text) {
      console.log("-> bash-end("+name+")");
      if (!bash_connections[name]) return;
      bash_connections[name].stdin.close();
      delete bash_connections[name]; bash_connections[name] = null;
    }

    socket
      .on("docker.containers", containers)
      .on("docker.images", images)
      .on("docker.container.start", start)
      .on("docker.container.stop", stop)
      .on("docker.container.pause", pause)
      .on("docker.container.unpause", unpause)
      .on("docker.container.remove", remove)
      .on("docker.container.create", create)
      .on('docker.container.logs', logs)
      .on('docker.bash.start', bash_start)
      .on('docker.bash.input', bash_input)
      .on('docker.bash.end', bash_end);

  }

  function broadcast(signal, data) {
    console.log("<= signal: "+signal);
    io.sockets.emit(signal, data);
  }

  function exec(cmd, callback) {
    if (cmd.length>40) {
      console.log("== "+cmd.slice(0, 30+cmd.slice(30).indexOf(' '))+" ...");
    } else {
      console.log("== "+cmd);
    }
    proc.exec(cmd, {maxBuffer: 10*1024*1024}, callback);
  }

  function fail(txt, data) {
    console.log("** "+txt, data);
  }

  var oldcontainer = null;
  function containerinspect(error, stdout, stderr) {
    if (error || stderr)
      return fail("inspect docker containers failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    running = "";
    JSON.parse(stdout).forEach(function(n) {
      if (n.State.Running) running+=" "+n.Name.replace(/^\//, '');
    });
    if (oldcontainer!=stdout) broadcast("docker.containers", stdout);
    oldcontainer = stdout;
  }
  
  var oldimage = null;
  function imageinspect(error, stdout, stderr) {
    if (error || stderr)
      return fail("inspect docker images failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    if (oldimage && oldimage==stdout) return; // do not resend same images
    oldimage = stdout;
    broadcast("docker.images", stdout);
  }

  function imagelist(error, stdout, stderr) {
    if (error || stderr)
      return fail("list docker images failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    exec("docker inspect "+stdout.trim().replace(/\n/g, " "), imageinspect);
  }

  function updateimages(error, stdout, stderr) {
    if (error || stderr)
      return fail("update docker images failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    exec("docker images -q --no-trunc", imagelist);
  }
  
  function containerlist(error, stdout, stderr) {
    if (error || stderr)
      return fail("list docker containers failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    var containers = stdout.trim().replace(/\n/g, " ");
    exec("docker inspect "+containers, containerinspect);
  }
  
  function updatecontainers(error, stdout, stderr) {
    if (error || stderr)
      return fail("update docker container failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    exec("docker ps -aq --no-trunc ", containerlist);
  }

  function stats(error, stdout, stderr) {
    if (error || stderr)
      return fail("get containers stats failed", {
        error: error, stderr: stderr, stdout: stdout
      });
    broadcast("docker.stats", stdout);
  }

  //==============================================================================

  if (app) {

    var path = require('path')

    // serve client display library
    app.get('/docker.js', function(req, res) {
      res.sendfile('docker.js', {root: __dirname});
    });
    
    // serve graphviz library
    app.get('/viz.js', function(req, res) {
      res.sendfile('viz.js', {root: path.dirname(require.resolve('viz.js'))});
    });
    
    // serve jquery library
    app.get('/jquery.js', function(req, res) {
      res.sendfile('jquery.min.js', {root: path.dirname(require.resolve('jquery'))});
    });

  }
  
  // Periodic Update of Images and Containers
  if (!updateContainerInterval) updateContainerInterval = 10000;
  setInterval(function() {
    updateimages();
    updatecontainers();
  }, updateContainerInterval);

  // Periodic Update of Stats
  if (!updateStatsInterval) updateStatsInterval = 1000;
  setInterval(function() {
    if (running) exec('docker stats --no-stream'+running, stats);
  }, updateStatsInterval);
  
  return this;
  
}
