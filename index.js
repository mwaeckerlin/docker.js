module.exports = function(app, io, updateContainerInterval, updateStatsInterval) {

  /// @todo change from exec to this
  var Docker = require('dockerode')
  var docker = new Docker()

  var running="";
  var proc = require('child_process');
  
  this.connect = function(socket) {

    var pty = require('pty.js');

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
    
    function nodes() {
      console.log("-> nodes");
      if (oldnode) emit("docker.nodes", oldnode);
      else updatenodes();
    }
    
    function services() {
      console.log("-> services");
      if (oldservice) emit("docker.services", oldservice);
      else updateservices();
    }
    
    function tasks() {
      console.log("-> tasks");
      if (oldtask) emit("docker.tasks", oldtask);
      else updatetask();
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
      .on("docker.nodes", nodes)
      .on("docker.services", services)
      .on("docker.tasks", tasks)
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

  var oldservice = null;
  function servicelist(error, data) {
    if (error)
      return fail("list docker services failed", {
        error: error, data: data
      })
    if (oldservice!=data)
      broadcast("docker.services", data)
    oldservice = data
  }

  function updateservices() {
    docker.listServices(servicelist)
  }

  var oldtask = null;
  function tasklist(error, data) {
    if (error)
      return fail("list docker tasks failed", {
        error: error, data: data
      })
    if (oldtask!=data)
      broadcast("docker.tasks", data)
    oldtask = data
  }

  function updatetasks() {
    docker.listTasks(tasklist)
  }

  var oldnode = null;
  function nodelist(error, data) {
    if (error)
      return fail("list docker nodes failed", {
        error: error, data: data
      })
    if (oldnode!=data)
      broadcast("docker.nodes", data);
    oldnode = data
  }

  function updatenodes() {
    docker.listNodes(nodelist)
  }

  var oldimage = null;
  function imagelist(error, data) {
    if (error)
      return fail("list docker images failed", {
        error: error, data: data
      })
    if (data!=oldimage)
      broadcast("docker.images", data)
    oldimage = data
  }

  function updateimages() {
    docker.listImages(imagelist)
  }
  
  var oldcontainer = null;
  function containerlist(error, data) {
    if (error)
      return fail("list docker containers failed", {
        error: error, data: data
      });
    if (data!=oldcontainer)
      broadcast("docker.containers", data)
    oldcontainer = data
  }
  
  function updatecontainers() {
    docker.listContainers(containerlist)
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

  function updateall() {
    updateimages()
    updatecontainers()
    updateservices()
    updatetasks()
    updatenodes()
  }
  
  // Periodic Update of Images and Containers
  updateall()
  setInterval(updateall, updateContainerInterval||5000)

  return this;  
}
