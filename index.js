module.exports = function(app, io, updateContainerInterval, updateStatsInterval) {

  var Docker = require('dockerode')
  var docker = new Docker()

  this.connect = function(socket) {

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
      emit("docker.fail", {'msg': txt, 'data': data});
    }

    function containers() {
      console.log("-> containers");
      if (oldcontainer) emit("docker.containers", oldcontainer);
      else updatecontainers();
    }

    function volumes() {
      console.log("-> volumes");
      if (oldvolume) emit("docker.volumes", oldvolume);
      else updatevolumes();
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
    
    socket
      .on("docker.containers", containers)
      .on("docker.volumes", volumes)
      .on("docker.nodes", nodes)
      .on("docker.services", services)
      .on("docker.tasks", tasks)
      .on("docker.images", images)
  }

  function broadcast(signal, data) {
    console.log("<= signal: "+signal);
    io.sockets.emit(signal, data);
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
    docker.listContainers({'all': true}, containerlist)
  }
  
  var oldvolume = null;
  function volumelist(error, data) {
    if (error)
      return fail("list docker volumes failed", {
        error: error, data: data
      })
    data = data.Volumes
    if (data!=oldvolume)
      broadcast("docker.volumes", data)
    oldvolume = data
  }
  
  function updatevolumes() {
    docker.listVolumes(volumelist)
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
    updatevolumes()
    updateservices()
    updatetasks()
    updatenodes()
  }
  
  // Periodic Update of Images and Containers
  updateall()
  setInterval(updateall, updateContainerInterval||5000)

  return this;  
}
