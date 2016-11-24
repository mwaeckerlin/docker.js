var Docker = function(socket, container_element, error) {

  var focused = null;
  var viz = null;
  var vizmore = null;
  var rankdir = "LR";

  function emit(signal, data) {
    console.log("<-snd "+signal, data);
    socket.emit(signal, data);
  }

  function same(array1, array2) {
    if (!array1 && !array2) return true;
    if (!array1 || !array2) return false;
    return (array1.length == array2.length)
        && array1.every(function(element, index) {
          return element === array2[index]; 
        });
  }

  function quote(text) {
    if (text.match(/[^-_:=\/a-zA-Z0-9]/)) {
      if (text.match('"')) {
        if (!text.match("'")) return "'"+text+"'";
        else return '"'+text.replace(/"/g, '\\"')+'"';
      } else {
        return '"'+text+'"';
      }
    } else {
      return text;
    }
  }
  
  var _docker = this;

  this.Images = function() {

    var _images = this;
    var images = [];
    var nodes = [];
    
    function setup() {
      delete nodes; nodes = [];
      images.forEach(function(c, i) {
        if (!nodes[c.Id]) nodes[c.Id] = {};
        nodes[c.Id].id = c.Id;
        nodes[c.Id].tags = c.RepoTags;
        nodes[c.Id].created = c.Created;
        nodes[c.Id].author = c.Author;
        nodes[c.Id].os = c.Os+"/"+c.Architecture;
        nodes[c.Id].parent = c.Parent;
        nodes[c.Id].env = c.Config.Env || [];
        nodes[c.Id].cmd = c.Config.Cmd;
        nodes[c.Id].entrypoint = c.Config.Entrypoint;
        nodes[c.Id].ports = [];
        if (c.Config.ExposedPorts)
          for (p in c.Config.ExposedPorts)
            nodes[c.Id].ports.push(p);
        nodes[c.Id].volumes = c.Config.Volumes;
        if (c.Parent) {
          if (!nodes[c.Parent]) nodes[c.Parent] = {};
          if (!nodes[c.Parent].children) nodes[c.Parent].children = [];
          nodes[c.Parent].children.push(c.Id);
        }
      });
    }
    this.tags = function() {
      var res = [];
      for (n in nodes) if (nodes[n].tags) res = res.concat(nodes[n].tags);
      return res;
    }
    this.get = function(tag) {
      for (n in nodes) if (nodes[n].tags && nodes[n].tags.indexOf(tag)>-1) return nodes[n];
      return null;
    }
    this.cleanup = function(id, instance) {
      if (!nodes[id]) return
      nodes[id].env.forEach(function(e) {
        if ((pos=instance.env.indexOf(e))>-1) instance.env.splice(pos, 1)
      })
      if (same(nodes[id].cmd, instance.cmd)) instance.cmd = null
      if (same(nodes[id].entrypoint, instance.entrypoint)) instance.entrypoint = null
    }
    this.set = function(c) {
      if (typeof c == "string") c = JSON.parse(c);
      if (typeof c != "object") throw "wrong format: "+(typeof c);
      images = c;
      setup();
    }
    
  }
  
  this.Containers = function() {

    var _containers = this;
    
    this.Status = Object.freeze({
      Error:      {
        color: "indianred1",
        action1: "start",
        action2: "remove",
        bash: false
      },
      Terminated: {
        color: "yellow2",
        action1: "start",
        action2: "remove",
        bash: false
      },
      Restarting: {
        color: "lightblue",
        action1: "start",
        action2: "remove",
        bash:
        false
      },
      Paused:     {
        color: "grey",
        action1: "unpause",
        action2: null,
        bash: false
      },
      Running:    {
        color: "lightgreen",
        action1: "pause",
        action2: "stop",
        bash: true
      },
      Preview:    {
        color: "orangered"
      },
      Prepared:   {
        color: "lightgrey"
      }
    });
    var containers = [];
    var nodes = [];
    function protocol(port) {
      if (port.toString().match("443")) return "https://";
      if (port.toString().match("3304")) return "mysql://";
      if (port.toString().match("22")) return "ssh://";
      return "http://";
    }
    this.exists = function(name) {
      if (nodes[name]) return true;
      return false;
    }
    function getIps(n, ips) {
      if (n.ports) n.ports.forEach(function(p) {
        if (!p.ip||p.ip==""||p.ip=="0.0.0.0"||p.ip==0)
          p.ip=window.location.hostname;
        if (!ips[p.ip]) ips[p.ip] = [];
        ips[p.ip].push(p);
      });
    }
    function graphIpClusters(ips) {
      var res = "newrank=true;\n";
      var i = 0;
      for (ip in ips) {
        res += "subgraph clusterIp"+(++i)+' {\nlabel="'+ip+'";\n';
        ips[ip].forEach(function(p) {
          res += '"'+p.ip+":"+p.external
                +'" [label="'+p.external+'",URL="'
                +protocol(p.internal)+p.ip+':'+p.external+'",shape=box];\n';
        });
        res+="}\n";
      }
      res += "{rank=same;\n";
      for (ip in ips) {
        ips[ip].forEach(function(p) {
          res += '"'+p.ip+":"+p.external+'";\n';
        });
      }
      res+="}\n";
      return res;
    }
    function graphNode(n, omitstats) {
      var res = "";
      var label = (n.image?n.image.name:'UNDEFINED')+'\\n'
                 +(n.name?n.name:"UNKNOWN")
                 +(omitstats?'':'\\n                       \\n                                   ');
      res += '"'+n.name+'"'
            +' [label="'+label
            +'",URL="#'+n.name
            +'",fillcolor='+(n.status?n.status.color+',style=filled':'red,shape=octagon,style=filled')+"];\n";
      if (n.ports) n.ports.forEach(function(p) {
        res += '"'+(p.ip?p.ip+":":"")+p.external+'" -> "'+n.name
              +'" [label="'+p.internal+'"];\n';
      });
      if (n.links) n.links.forEach(function(l) {
        res += '"'+n.name+'" -> "'+l.container+'" [label="link: '+l.name+'"];\n'
      });
      return res;
    }
    function graphVolumesInside(n) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        res += '"'+v.id+v.inside+'" [label="'+v.inside+'",shape=box];\n';
      });
      return res;
    }
    function graphVolumesOutside(n) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        if (v.host)
          res += '"'+v.outside+'" [label="'+v.host+'",shape=box];\n';
      });
      return res;
    }
    function graphVolumesConnections(n, nodes) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        if (v.host)
          res += '"'+v.id+v.inside+'" -> "'+v.outside+'" [label="mounted from"]\n';
        res += '"'+n.name+'" -> "'+v.id+v.inside+'" [label="volume/'+v.rw+'"]\n';
      });
      if (n.volumesfrom) n.volumesfrom.forEach(function(o) {
        res += '"'+n.name+'" -> "'+nodes[o].name+'" [label="volumes from"]\n';
      });
      return res;
    }
    this.graph = function(n, omitstats) {
      var res = "";
      var ips = [];
      n = n || nodes;
      for (name in n) getIps(n[name], ips);
      res += graphIpClusters(ips);
      for (name in n) res += graphNode(n[name], omitstats);
      res += "{rank=same;\n";
      for (name in n) res += graphVolumesInside(n[name]);
      res+="}\n";
      res += "{rank=same;\n";
      for (name in n) res += graphVolumesOutside(n[name]);
      res+="}\n";
      for (name in n) res += graphVolumesConnections(n[name], n);
      return res;
    }
    function addNodes(ns, name) {
      var n = nodes[name] || ns[name] || {name: name};
      ns[name] = n;
      if (n.links) n.links.forEach(function(peer) {
        if (!ns[peer.container]) addNodes(ns, peer.container);
      });
      if (n.usedby) n.usedby.forEach(function(peer) {
        if (!ns[peer]) addNodes(ns, peer);
      });
      if (n.volumesfrom) n.volumesfrom.forEach(function(peer) {
        if (!ns[peer]) addNodes(ns, peer);
      });
      if (n.volumesto) n.volumesto.forEach(function(peer) {
        if (!ns[peer]) addNodes(ns, peer);
      });
    }
    this.subnet = function(name, nodes) {
      var ns = nodes || {};
      addNodes(ns, name);
      return ns;
    }
    this.subgraph = function(name, nodes) {
      return this.graph(this.subnet(name, nodes), nodes);
    }
    this.configuration = function(name) {
      var ns = name;
      if (typeof name == 'string') ns = this.subnet(name);
      var creates = [];
      for (n in ns) {
        var instance = {
          name: ns[n].name,
          image: ns[n].image.name,
          ports: ns[n].ports,
          env: ns[n].env,
          cmd: ns[n].cmd,
          entrypoint: ns[n].entrypoint,
          volumesfrom: ns[n].volumesfrom,
          links: ns[n].links,
          volumes: []
        };
        if (ns[n].ports) ns[n].ports.forEach(function(p) {
          if (p.ip && !p.ip.match(/^([0-9]{1,3}\.){3}[0-9]{1,3}$/)) p.ip = null;
        });
        ns[n].volumes.forEach(function(v) {
          if (v.host) instance.volumes.push({
            inside: v.inside,
            outside: v.host
          });
        });
        _docker.images.cleanup(ns[n].image.id, instance);
        creates.push(instance);
      }
      creates.sort(function(a, b) {
        if (a.volumesfrom.indexOf(b.name)>=0) return 1; // a after b
        if (b.volumesfrom.indexOf(a.name)>=0) return -1; // a before b
        for (var i=0; i<a.links.length; ++i) if (a.links[i].container == b.name) return 1; // a after b;
        for (var i=0; i<b.links.length; ++i) if (b.links[i].container == a.name) return -1; // a before b;
        if ((b.volumesfrom.length || b.links.length) && !(a.volumesfrom.length || a.links.length)) return 1; // a after b; 
        if ((a.volumesfrom.length || a.links.length) && !(b.volumesfrom.length || b.links.length)) return 1; // a after b; 
        return 0; // a and b do not depend on each other
      });
      return creates;
    }
    this.creation = function(configuration) {
      var res = [];
      if (typeof configuration === 'string')
        configuration = JSON.parse(configuration);
      if (!configuration || !configuration.length)
        throw new Error("undefined configuration");
      for (var key=0; key<configuration.length; ++key) {
        var n = configuration[key];
        var cmd = "docker create";
        if (n.name) cmd+=" --name "+quote(n.name);
        if (n.ports) n.ports.forEach(function(p) {
          cmd += " --publish "+quote((p.ip?p.ip+":":"")+p.external+":"+p.internal)
        });
        if (n.env) n.env.forEach(function(e) {
          cmd += ' --env '+quote(e);
        });
        if (n.volumes) n.volumes.forEach(function(v) {
          cmd += ' --volume '+quote(v.outside+':'+v.inside);
        });
        if (n.volumesfrom) n.volumesfrom.forEach(function(v) {
          cmd += ' --volumes-from '+quote(v);
        })
        if (n.links) n.links.forEach(function(l) {
          cmd += ' --link '+quote(l.container+':'+l.name);
        });
        if (n.entrypoint && n.entrypoint.length) cmd += ' --entrypoint '+quote(n.entrypoint.join(" "));
        if (!n.image) throw new Error("container: "+key+"; undefined image");
        cmd += " "+quote(n.image);
        if (n.cmd) n.cmd.forEach(function(c) {
          cmd+= ' '+quote(c);
        });
        res.push(cmd);
      }
      return res;
    }
    this.names = function(more) {
      if (more) return Object.keys(nodes).concat(Object.keys(more))
        else return Object.keys(nodes);
    }
    function setup() {
      delete nodes; nodes = [];
      containers.forEach(function(c, i) {
        var name = c.Name.replace(/^\//, "");
        if (!nodes[name]) nodes[name] = {};
        nodes[name].id = c.Id;
        nodes[name].name = name;
        nodes[name].image = {
          name: c.Config.Image,
          id: c.Image
        };
        nodes[name].env = c.Config.Env;
        nodes[name].cmd = c.Config.Cmd;
        nodes[name].entrypoint = c.Entrypoint;
        nodes[name].ports = [];
        var ports = c.NetworkSettings.Ports || c.NetworkSettings.PortBindings;
        if (ports)
          for (var port in ports)
            if (ports[port])
              for (var expose in ports[port]) {
                var ip = ports[port][expose].HostIp;
                if (!ip||ip==""||ip=="0.0.0.0"||ip==0) ip=window.location.hostname;
                nodes[name].ports.push({
                  internal: port,
                  external: ports[port][expose].HostPort,
                  ip: ip
                });
              }
        if (c.State.Paused) nodes[name].status = _containers.Status.Paused;
        else if (c.State.Running) nodes[name].status = _containers.Status.Running;
        else if (c.State.Restarting) nodes[name].status = _containers.Status.Restarting;
        else if (c.State.ExitCode == 0) nodes[name].status = _containers.Status.Terminated;
        else nodes[name].status = _containers.Status.Error;
        nodes[name].volumes = [];
        var volumes = c.Volumes || c.Config.Volumes;
        nodes[name].volumes = [];
        if (volumes)
          for (var volume in volumes) {
            var rw = "rw";
            var outside = (typeof volumes[volume]=="string")?volumes[volume]:null;
            if (c.Mounts) c.Mounts.forEach(function(mnt) {
              if (mnt.Destination==volume) {
                outside = mnt.Source;
                rw = mnt.RW ? "rw" : "ro";
              }
            });
            nodes[name].volumes.push({
              id: volume+':'+(outside?outside:name),
              rw:rw,
              inside: volume,
              outside: outside,
              host: outside && !outside.match(/^\/var\/lib\/docker/)
            ? outside : null
            });
          }
        nodes[name].volumesfrom = [];
        if (!nodes[name].volumesto) nodes[name].volumesto = [];
        if (c.HostConfig.VolumesFrom) c.HostConfig.VolumesFrom.forEach(function(id) {
          containers.forEach(function(c) {
            if (c.Id == id || c.Name == "/"+id || c.Name == id) {
              var src = c.Name.replace(/^\//, "");
              nodes[name].volumesfrom.push(src);
              if (!nodes[src]) nodes[src] = {};
              if (!nodes[src].volumesto) nodes[src].volumesto = [];
              nodes[src].volumesto.push(name);
            }
          });
        });
        nodes[name].links = [];
        if (!nodes[name].usedby) nodes[name].usedby = [];
        if (c.HostConfig && c.HostConfig.Links)
          c.HostConfig.Links.forEach(function(l) {
            var target = {
              container:   l.replace(/^\/?([^:]*).*$/, "$1"),
              name: l.replace(new RegExp("^.*:/?"+name+"/"), "")
            };
            nodes[name].links.push(target);
            if (!nodes[target.container]) nodes[target.container] = {};
            if (!nodes[target.container].usedby) nodes[target.container].usedby = [];
            nodes[target.container].usedby.push(name);
          });
      });
      for (name in nodes) { // cleanup duplicate links to volumes when using volumes-from
        var n = nodes[name];
        n.volumesfrom.forEach(function(other) {
          var o = nodes[other];
          o.volumes.forEach(function(ovol) {
            n.volumes.reduceRight(function(x, nvol, i, arr) {
              if (nvol.id == ovol.id)
                arr.splice(i, 1);
            }, [])
          })
        })
      }
    }
    this.contextmenu = function(selector) {
      $('a[xlink\\:href^=#]').click(function(e) {
        var name = $(this).attr("xlink:href").replace(/^#/, "");
        var n = nodes[name];
        $(selector).prepend('<div id="popup"></div>')
        $("#popup").empty();
        if (n.status.action1) {
          $("#popup").append('<button id="popup1">'+n.status.action1+'</button>');
          $("#popup1").click(function() {
            emit('docker.container.'+n.status.action1, name);
          });
        }
        $("#popup").append('<button id="popup2">'+(focused?"overview":"focus")+'</button>');
        $("#popup2").click(function() {
          if (focused) overview(); else details(name);
        });
        if (n.status.action2) {
          $("#popup").append('<button id="popup3">'+n.status.action2+'</button>');
          $("#popup3").click(function() {
            emit('docker.container.'+n.status.action2, name);
          });
        }
        $("#popup").append('<br/>');
        $("#popup").append('<button id="popup4">logs</button>');
        $("#popup4").click(function() {
          showLogs();
          emit("docker.container.logs", name);
        });
        if (n.status.bash) {
          $("#popup").append('<button id="popup5">bash</button>');
          $("#popup5").click(function() {
            showConsole();
            emit("docker.container.bash.start", name);
            $("#screen").focus();
            $("#screen").keypress(function(e) {
              console.log("keypress", e);
              e.preventDefault();
              if (e.keyCode) emit("docker.container.bash.input", {name: name, text: String.fromCharCode(e.keyCode)});
              else if (e.charCode) emit("docker.container.bash.input", {name: name, text: String.fromCharCode(e.charCode)});
              $("#screen").focus();
            });
            // $("#bash").submit(function() {
            //     emit("docker.container.bash.input", {name: name, text: $("#command").val()+"\n"});
            //     $("#command").val("");
            // })
          });
        }
        $("#popup").append('<button id="popup6">download</button>');
        $("#popup6").click(function() {
          var download = document.createElement('a');
          download.href = 'data:application/json,'
                        + encodeURI(JSON.stringify(_containers.configuration(name), null, 2));
          download.target = '_blank';
          download.download = name+'.json';
          var clickEvent = new MouseEvent("click", {
            "view": window,
            "bubbles": true,
            "cancelable": false
          });
          download.dispatchEvent(clickEvent);
        });
        $("#popup").css("position", "fixed");
        $("#popup").css("top", e.pageY-$("#popup").height()/4);
        $("#popup").css("left", e.pageX-$("#popup").width()/2);
        $("#popup").mouseleave(function() {
          $("#popup").hide();
        }).click(function() {
          $("#popup").hide();
        });
        $("#popup").show();
      })
    }
    this.set = function(c) {
      if (typeof c == "string") c = JSON.parse(c);
      if (typeof c != "object") throw "wrong format: "+(typeof c);
      containers = c;
      setup();
    }
  }

  this.images = new this.Images();
  this.containers = new this.Containers();

  this.rotate() {
    if (!viz) return;
    if (rankdir == "LR")
      rankdir = "TB";
    else
      rankdir = "LR";
    this.show();
  }

  this.show = function(vizpath, more) {
    if (!vizpath) {
      vizpath = viz;
      more = vizmore;
    } else {
      viz = vizpath;
      vizmore = more;
    }
    res = "digraph {\n"+"  rankdir="+rankdir+";\n"+viz+"\n}";
    try {
      $(container_element).html(more?Viz(res)+more:Viz(res));
      stats();
      $(container_element+' a > ellipse + text').attr('font-size', '12');
      $(container_element+' a > ellipse + text + text')
        .attr('font-weight', 'bold')
        .attr('font-size', '16')
        .each(function() {$(this).attr('y', parseFloat($(this).attr('y'))+1.0)});
      $(container_element+' a > ellipse + text + text + text, #main a > ellipse + text + text + text + text').attr('font-size', '10');
    } catch(e) {
      (res = res.split("\n")).forEach(function(v, i, a) {
        a[i] = ("000"+(i+1)).slice(-3)+": "+v;
      });
      $(container_element).html("<h2>Exception Caught:</h2><p>"+e+"<p><pre>"+res.join("\n")+"</pre>");
    }
  }

  function overview() {
    focused = null;
    this.show(this.containers.graph());
  }

  function details(name) {
    if (name) focused = name;
    else if (!focused) return overview();
    this.show(this.containers.subgraph(focused));
  }

  function containers(c) {
    console.log("->rcv containers");
    this.containers.set(c);
    if (focused && this.containers.exists(focused))
      details(focused);
    else
      overview();
  }
  
  var laststats=null;
  function stats(data) {
    if (data)
      console.log("->rcv stats");
    else
      data=laststats;
    if (!data) return;
    var lines = data.split("\n");
    var head = lines.shift();
    lines.forEach(function(line) {
      if (!line) return;
      elements = line.split(/ +/);
      $('#main text + text:contains("'+elements[0]+'") + text + text')
        .html('cpu: '+elements[1]+' mem: '+elements[7]);
      $('#main text + text:contains("'+elements[0]+'") + text')
        .html('net: '+elements[8]+elements[9]+' '+elements[11]+elements[12]
             +' block: '+elements[13]+elements[14]+' '+elements[16]+elements[17]);
    });
  }

  socket
    .on("docker.fail", error)
    .on("docker.containers", containers)
    .on("docker.stats", stats);

}

if (typeof module === 'undefined') module = {};
module.exports = {
  Docker: Docker
}
