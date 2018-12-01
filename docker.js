var Docker = function(socket, error, sigstack, sigcontainer) {

  var focused = null;
  var viz = null;
  var vizmore = null;
  var rankdir = "LR";
  var docker = this;

  function Graphics() {
    
    function nicebytes(bytes) {
      var val = bytes
      if (val<1024) return (Math.round(val*100)/100)+" B";
      val /= 1024
      if (val<1024) return (Math.round(val*100)/100)+" kB";
      val /= 1024
      if (val<1024) return (Math.round(val*100)/100)+" MB";
      val /= 1024
      if (val<1024) return (Math.round(val*100)/100)+" GB";
      val /= 1024
      return (Math.round(val*100)/100)+" TB";
    }

    function datediff(date) {
      var val = (new Date()) - date
      if (val<2000) return Math.round(val)+'ms';
      val /= 1000
      if (val<120) return Math.round(val)+'s';
      val /= 60
      if (val<120) return Math.round(val)+'min';
      val /= 60
      if (val<48) return Math.round(val)+'h';
      val /= 24
      return Math.round(val)+'d';
    }

    this.colors = {
      'status': {
        'created':    'yellow',       // created but not yet started
        'running':    'springgreen3', // stable since more than an hour
        'started':    'springgreen',  // started within the last hour
        'starting':   'darkorange',   // starting but not yet ready
        'restarting': 'lightsalmon',  // process is unstable and restarting
        'stopped':    'yellow',       // manually stopped
        'paused':     'lightskyblue', // manually paused
        'dead':       'indianred1',   // died, no running process
        'exited':     'indianred1'    // exited, no running process
      },
      'node': {
        'manager':    'turquoise1',   // node is a manager but not the leader
        'leader':     'greenyellow',  // node is the lead manager
        'worker':     'palegreen'     // node is a worker
      },
      'availability': {
        'active':     'springgreen3', // node is ready, active and reachable
        'drain':      'gray',         // node is drained
        'dead':       'indianred1',   // node is not ready or not reachable
        'unknown':    'darkorange'    // nothing of the above
      }
    }

    this.parameters = {
      'rankdir': 'LR',
      'nodesep': 1,
      'ranksep': 3
    }

    this.header = (parameters = this.parameters) => {
      var res = "digraph {\n"
              + '  node [style=filled];\n'
      for (var name in parameters) {
        res += '  '+name+'="'+parameters[name]+'";\n'
      }
      return res
    }

    this.footer = () => {
      return '}'
    }

    this.standalone = (colors = this.colors) => {
      var volumes = docker.volumes.get()
      var containers = docker.containers.get()
      var usedvolumes = {}
      var res = ""
      containers.filter((c) => {
        return !c.Labels['com.docker.swarm.service.id']
      }).forEach((c) => {
        // container
        var name = c.Names.find((n) => {return !n.match(/\/.*\//)}).replace(/^\//, '')
        var url = c.Labels['url']
        var color = colors.status[c.State] ? colors.status[c.State] : 'grey40'
        res += '  "'+c.Id+'" [label=<<font point-size="10">'+c.Image+'</font><br/><b>'+name+'</b><br/><font point-size="10">'+c.Status+'</font>>'
            +  ',color='+color
            +  (url?',href="'+url+'"':'')+'];\n'
        // ports
        c.Ports.forEach((p) => {
          res += '  "'+p.IP+':'+p.PublicPort+'" [label="'+p.PublicPort+'"];\n'
              +  '  "'+p.IP+':'+p.PublicPort+'" -> "'+c.Id+'" [label="'+p.PrivatePort+'/'+p.Type+'"];\n'
        })
        // links
        var links = c.Names.filter((n) => {return n.match(/^\/[^/]+\/[^/]+/)})
        links.forEach((link) => {
          var d = link.replace(/^\//, '').split('/')
          res += '  "'+containers.find((c) => {
            return c.Names.find((n) => {return n=='/'+d[0]})
          }).Id+'" -> "'+c.Id+'" [label="'+d[1]+'"]\n;'
        })
        // volumes
        if (c.Mounts) c.Mounts.forEach((m) => {
          switch (m.Type) {
            case 'bind': {
              res += '  "'+m.Source+'" [shape=box];\n'
                  +  '  "'+c.Id+'" -> "'+m.Source
                  +  '" [style=dashed,label=<'+m.Destination+'<font point-size="10">:'+(m.RW?'rw':'ro')+'</font>>];\n'
            } break
            case 'volume': {
              var v = volumes.find((v) => {return v.Name==m.Name})
              if (!v)
                break
              if (v.Driver=='local' && v.Mountpoint.match(/^\/var\/lib\/docker\/volumes\//)) {
                usedvolumes[m.Name] = true
              } else {
                res += '  "'+m.Name+'" [shape=box];\n'
                    +  '  "'+name+'" -> "'+m.Name
                    +  '" [style=dashed,label=<'+m.Destination+'<font point-size="10">:'+(m.RW?'rw':'ro')+'</font>>];\n'
              }
            } break
          }
        })
      })
      // handle volumes-from
      for (var volname in usedvolumes) {
        var m = null
        res += '  "'
            +  containers.filter((p) => {
              return p.Mounts && p.Mounts.find((pm) => {
                if (pm.Type=='volume' && pm.Name==volname) {
                  m = pm
                  return true
                }
                return false
              })
            }).map((p) => {
              return p.Id
            }).join('" -> "')
        res += '" [dir=none,style=dashed,label=<'+m.Destination+'<font point-size="10">:'
            +  (m.RW?'rw':'ro')+'</font>>];\n'
      }
      return res
    }
    
    this.stack = (colors = this.colors) => {
      var nodes = docker.nodes.get()
      var services = docker.services.get()
      var tasks = docker.tasks.get()
      var ports = {};
      var stacks = services.map((s) => {
        return s.Spec.Labels['com.docker.stack.namespace']
      }).filter((s, i, a) => {
        return a.indexOf(s) === i
      })
      var res = ""
      // ports
      res += (()=> {
        var res = ""
        services.forEach((s) => {
          var firstport = null
          var lastport = null
          var firsttargetport = null
          var lasttargetport = null
          var protocol = null
          if (s.Endpoint && s.Endpoint.Ports)
            s.Endpoint.Ports.forEach((p) => {
              ports[p.PublishedPort] = s;
              if (lastport) {
                if (protocol!=p.Protocol || p.PublishedPort>lastport+1) {
                  if (firstport==lastport)
                    res += "      \""+firstport+"\";\n"
                        +  "      \""+firstport+"\" -> \""
                        +  s.Spec.Labels['com.docker.stack.namespace']
                        +  "\" [label=\""+firsttargetport+'/'+protocol+"\"];\n"
                  else
                    res += "      \""+firstport+"-"+lastport+"\";\n"
                        +  "      \""+firstport+"-"+lastport+"\" -> \""
                        +  s.Spec.Labels['com.docker.stack.namespace']
                        +  "\" [label=\""+firsttargetport+"-"+lasttargetport+'/'+protocol+"\"];\n"
                  firstport = lastport = p.PublishedPort
                  firsttargetport = lasttargetport = p.TargetPort
                  protocol = p.Protocol
                } else {
                  lastport = p.PublishedPort
                  lasttargetport = p.TargetPort
                }
              } else {
                firstport = lastport = p.PublishedPort
                firsttargetport = lasttargetport = p.TargetPort
                protocol = p.Protocol
              }
            })
          if (firstport) {
            if (firstport==lastport)
              res += "      \""+firstport+"\";\n"
                  +  "      \""+firstport+"\" -> \""
                  +  s.Spec.Labels['com.docker.stack.namespace']
                  +  "\" [label=\""+firsttargetport+'/'+protocol+"\"];\n"
            else
              res += "      \""+firstport+"-"+lastport+"\";\n"
                  +  "      \""+firstport+"-"+lastport+"\" -> \""
                  +  s.Spec.Labels['com.docker.stack.namespace']
                  +  "\" [label=\""+firsttargetport+"-"+lasttargetport+'/'+protocol+"\"];\n"
          }
        })
        return res
      })()
      // stacks
            +(() => {
              var res = ""
              stacks.forEach((st) => {
                var error = 0
                var link = ""
                res += "    \""+st+"\" [shape=box,label=< \n"
                    +  "      <TABLE>\n"
                    +  "        <TR><TD COLSPAN=\"4\"><FONT POINT-SIZE=\"24\"><B>"+st+"</B></FONT></TD></TR>\n"
                // services in stacks
                services.filter((s) => {
                  return st == s.Spec.Labels['com.docker.stack.namespace']
                }).forEach((s) => {
                  var localerror = 0
                  if ((new Date())-(new Date(s.UpdatedAt))<3600000)
                    localerror = 1
                  if (s.Spec.Mode.Replicated) {
                    if (s.Spec.Mode.Replicated.Replicas<1) {
                      localerror = 2
                    }
                  }
                  if (error<localerror) error = localerror;
                  var color = "BGCOLOR=\""+(localerror==0
                                           ?colors.status.running
                                           :(localerror==1
                                            ?colors.status.started
                                            :colors.status.dead))
                             +"\""
                  if (s.Spec.TaskTemplate.ContainerSpec.Labels['url'])
                    link = ",href=\""+s.Spec.TaskTemplate.ContainerSpec.Labels['url']+"\""
                  res += "        <TR><TD PORT=\""+s.ID+"\" "+color+"\>"
                      +  s.Spec.Name.replace(st+'_', '')
                      +  "</TD><TD "+color+">"+s.Spec.TaskTemplate.ContainerSpec.Image.replace(/@.*$/, '').replace(/:latest$/, '')
                      +  "</TD><TD "+color+">"+datediff(new Date(s.UpdatedAt))
                      +  "</TD><TD PORT=\"l"+s.ID+"\" "+color+">"+(s.Spec.Mode.Replicated?s.Spec.Mode.Replicated.Replicas:"")+"</TD></TR>\n"
                })
                res += "      </TABLE>\n"
                    +  "    >,fillcolor="
                    +  (error==0
                       ?colors.status.running
                       :(error==1
                        ?colors.status.started
                        :colors.status.dead))
                    +  link
                    +  "];\n"
              })
              return res
            })()
      // nodes
            +(() => {
              var res = ""
              if (!nodes) return res;
              res += "  subgraph clusterNodes {\n"
                  +  "    style=invis;\n"
              nodes.forEach((node) => {
                res += "    \""+node.ID+"\" [shape=box,label=<\n"
                    +  "      <TABLE>"
                    +  "        <TR><TD BGCOLOR=\""
                    +  (node.Spec.Role!="manager"
                       ?colors.node.manager
                       :(node.ManagerStatus&&node.ManagerStatus.Leader
                        ?colors.node.leader
                        :colors.node.worker))
                    +  "\" COLSPAN=\"4\"><FONT POINT-SIZE=\"24\"><B>"+node.Description.Hostname+"</B></FONT></TD></TR>\n"
                    +  "        <TR><TD>Platform:</TD><TD COLSPAN=\"3\">"+node.Description.Platform.OS+" "+node.Description.Platform.Architecture+"</TD></TR>\n"
                    +  "        <TR><TD>Engine:</TD><TD COLSPAN=\"3\">"+node.Description.Engine.EngineVersion+"</TD></TR>\n"
                    +  "        <TR><TD>CPUs:</TD><TD COLSPAN=\"3\">"+(node.Description.Resources.NanoCPUs/1000000000)+"</TD></TR>\n"
                    +  "        <TR><TD>Memory:</TD><TD COLSPAN=\"3\">"+nicebytes(node.Description.Resources.MemoryBytes)+"</TD></TR>\n"
                    +  "        <TR><TD>Addr:</TD><TD COLSPAN=\"3\">"+node.Status.Addr+"</TD></TR>\n"
                // tasks
                    +  (() => {
                      var res = ""
                      if (!stacks) return res;
                      stacks.forEach((st) => {
                        var first = true
                        tasks.filter((p) => {
                          return st == p.Spec.ContainerSpec.Labels['com.docker.stack.namespace']
                              && p.DesiredState=="running" && node.ID==p.NodeID
                        }).forEach((p, i, procs) => {
                          var color = "BGCOLOR=\""
                                    + (p.Status.State=='running'
                                      ?((new Date())-(new Date(p.UpdatedAt))<3600000
                                       ?colors.status.started
                                       :colors.status.running)
                                      :(p.Status.State=='starting'
                                       ?colors.status.starting
                                       :colors.status.dead))
                                    + "\""
                          var color1 = p.Status.State=='running'
                                     ? "BGCOLOR=\""+colors.status.running+"\""
                                     : color
                          res += "        <TR>"
                          if (first)
                            res += "<TD ROWSPAN=\""+procs.length
                                +  "\" PORT=\""+st+"\" "+color1+"><B>"
                                +  st
                                +  "</B></TD>"
                          res += "<TD "+color+">"
                              +  (() => {
                                var res = ""
                                services.filter((s) => {
                                  return s.ID == p.ServiceID
                                }).forEach((s) => {
                                  res += s.Spec.Name.replace(st+'_', '')
                                })
                                return res
                              })()
                              +  "</TD><TD "+color+">"+p.Status.State
                              +  "</TD><TD "+color+">"+datediff(new Date(p.UpdatedAt))+"</TD></TR>\n"
                          first = false
                        })
                      })
                      res += "      </TABLE>\n"
                          +  "    >,fillcolor="
                          +  ((node.Status.State!='ready'||
                               (node.ManagerStatus&&node.ManagerStatus.Reachability!='reachable'))
                             ?colors.availability.dead
                             :(node.Spec.Availability=='active'
                              ?colors.availability.active
                              :(node.Spec.Availability=='drain'
                               ?colors.availability.drain
                               :colors.availability.unknown)))+"];\n"
                      return res
                    })()
              })
              res += "  }\n"
              // connect stacks with tasks
              nodes.forEach((node) => {
                stacks.forEach((st) => {
                  if (tasks.find((p) => {
                    return st == p.Spec.ContainerSpec.Labels['com.docker.stack.namespace']
                        && p.DesiredState=="running" && node.ID==p.NodeID
                  }))
                    res += "      \""+st+"\" -> \""+node.ID+"\":\""+st+"\";\n"
                })
              })
              services.forEach((s) => {
                // add port forwarding as specified in label 'forwards'
                if (s.Spec.TaskTemplate.ContainerSpec.Labels['forwards'])
                  s.Spec.TaskTemplate.ContainerSpec.Labels['forwards'].split(' ').forEach((port) => {
                    if (ports[port]) {                         
                      res += "      \""+s.Spec.Labels['com.docker.stack.namespace']
                          +  "\" -> \""+port+"\";\n"
                      if (ports[port].Spec.TaskTemplate.ContainerSpec.Labels['url'])
                        res += "      \""+ports[port].Spec.TaskTemplate.ContainerSpec.Labels['url']
                            +  "\" [href=\""
                            +  ports[port].Spec.TaskTemplate.ContainerSpec.Labels['url']
                            +  "\"];\n      \""
                            +  ports[port].Spec.TaskTemplate.ContainerSpec.Labels['url']
                            +  "\" -> \""+s.Spec.Labels['com.docker.stack.namespace']+"\";\n"
                    }
                  })
                if (s.Spec.TaskTemplate.ContainerSpec.Labels['urls'])
                  s.Spec.TaskTemplate.ContainerSpec.Labels['urls'].split(' ').forEach((url) => {
                    res += "    \""+url+"\" [href=\""+url+"\"];\n"
                        +  "    \""+url+"\" -> \""+s.Spec.Labels['com.docker.stack.namespace']
                        +  "\";\n"
                  })
              })
              return res
            })()
      return res
    }
    
    this.viz = (dot, err = null) => {
      try {
        return Viz(dot)
      } catch(e) {
        var codelines = dot.replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .split("\n")
        codelines.forEach(function(v, i, a) {
            a[i] = ("000"+(i+1)).slice(-3)+": "+v;
          })
        throw({'msg': e, 'data': codelines.join("\n")})
      }
    }
  }

  function emit(signal, data) {
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
        color: "darkorange",
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
        color: "springgreen",
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
      //var res = "newrank=true;\n";
      var res = ''
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
      /*
      res += "{rank=same;\n";
      for (ip in ips) {
        ips[ip].forEach(function(p) {
          res += '"'+p.ip+":"+p.external+'";\n';
        });
      }
      res+="}\n";
      */
      return res;
    }
    function graphNode(n) {
      var res = 'subgraph cluster'+n.name.replace(/[^a-zA-Z0-9]/g, '_')+' {\n';
      var label = '<FONT point-size="10">'
                 +(n.image?n.image.name:'UNDEFINED')
                 +'</FONT><BR/><FONT point-size="18"><B>'
                 +(n.name?n.name:"UNKNOWN")+'</B></FONT>'
      res += '"'+n.name+'"'
            +' [label=<'+label
            +'>,URL="#'+n.name
            +'",fillcolor='+(n.status?n.status.color:'red,shape=octagon')+',style=filled];'+"\n";
      if (n.ports) n.ports.forEach(function(p) {
        res += '"'+(p.ip?p.ip+":":"")+p.external+'" -> "'+n.name
              +'" [label="'+p.internal+'",style=dashed];\n';
      });
      res+=graphVolumesInside(n)
      res+='}\n'
      if (n.links) n.links.forEach(function(l) {
        res += '"'+n.name+'" -> "'+l.container+'" [label="'+l.name+'",style=dashed];\n'
      })
      return res
    }
    function graphVolumesInside(n) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        res += '"'+v.id+'" [label="'+v.inside+'",shape=none,margin=0,width=0,height=0];\n';
      });
      return res;
    }
    function graphVolumesOutside(n) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        if (v.host)
          res += '"'+v.outside+'" [label="'+v.outside+'",shape=box];\n';
      });
      return res;
    }
    function graphVolumesConnections(n, nodes) {
      var res = "";
      if (n.volumes) n.volumes.forEach(function(v) {
        if (v.host)
          res += '"'+v.id+'" -> "'+v.outside+'" [label="'+v.rw+'"]\n';
        //res += '"'+n.name+'" -> "'+v.id+'" [label="volume/'+v.rw+'"]\n';
      });
      if (n.volumesfrom) n.volumesfrom.forEach(function(o) {
        res += '"'+n.name+'" -> "'+nodes[o].name+'"\n';
      });
      return res;
    }
    this.graph = function(n) {
      var res = "";
      var ips = [];
      n = n || nodes;
      for (name in n) getIps(n[name], ips);
      res += graphIpClusters(ips);
      res += 'subgraph clusterAllNodes {style=invis;\n'
      for (name in n) res += graphNode(n[name]);
      //res += "{rank=same;\n";
      //for (name in n) res += graphVolumesInside(n[name]);
      //res+="}\n";
      res += 'subgraph clusterAllVolumesOutside {\n';
      for (name in n) res += graphVolumesOutside(n[name]);
      res += '}\n';
      res += '}\n'
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
      return this.graph(this.subnet(name, nodes));
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
            outside: v.outside
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
        var name = c.Names[0].replace(/^\//, "");
        if (!nodes[name]) nodes[name] = {};
        nodes[name].id = c.Id;
        nodes[name].name = name;
        nodes[name].image = {
          name: c.Image,
          id: c.ImageID
        };
        nodes[name].env = null
        nodes[name].cmd = c.Command;
        nodes[name].entrypoint = c.Entrypoint;
        nodes[name].ports = [];
        var ports = c.Ports
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
        var volumes = [] // c.Mounts.Type == 'bind', Source, Destination
        if (volumes) volumes.forEach(function(vol) {
          var vs = []
          if (typeof vol === 'string')
            vs = [ vol.split(':')[1] ];
          else if (typeof vol === 'object')
            vs = Object.keys(vol);
          vs.forEach(function(v) {
            if (c.Mounts) c.Mounts.forEach(function(mnt) {
              if (mnt.Destination==v)
                nodes[name].volumes.push({
                  id: mnt.Source+':'+mnt.Destination,
                  rw: mnt.RW ? "rw" : "ro",
                  inside: mnt.Destination,
                  outside: mnt.Source,
                  host: !mnt.Driver || mnt.Driver!='local'
                })
            })
          })
        })
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
      $('a[xlink\\:href^="#"]').click(function(e) {
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


  this.Storage = function() {

    var storage = []

    this.get = function() {
      return storage
    }

    this.set = function(c) {
      if (typeof c == "string") c = JSON.parse(c);
      if (typeof c != "object") throw "wrong format: "+(typeof c);
      storage = c;
    }
    
  }

  this.graphics = new Graphics()
  this.volumes = new this.Storage()
  this.containers = new this.Storage()
  this.services = new this.Storage()
  this.tasks = new this.Storage()
  this.images = new this.Images();
  this.nodes = new this.Storage()

  this.rotate = function() {
    if (!viz) return;
    if (rankdir == "LR")
      rankdir = "TB";
    else
      rankdir = "LR";
    docker.show();
  }

  this.show = function(vizpath, more) {
    if (!container_element) return;
    if (!vizpath) {
      vizpath = viz;
      more = vizmore;
    } else {
      viz = vizpath;
      vizmore = more;
    }
    res = "digraph {\n"
         +"rankdir="+rankdir+";\n"
         +'nodesep=0.02;\n'
         +viz
         +"\n}";
    try {
      $(container_element).html(more?Viz(res)+more:Viz(res));
      //$(container_element).html('<pre>'+res.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')+'</pre>');
      $("svg g a").attr('xlink:title', '');
      stats()
      docker.containers.contextmenu(container_element);
    } catch(e) {
      (res = res.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split("\n")).forEach(function(v, i, a) {
        a[i] = ("000"+(i+1)).slice(-3)+": "+v;
      });
      $(container_element).html("<h2>Exception Caught:</h2><p>"+e+"<p><pre>"+res.join("\n")+"</pre>");
      throw e;
    }
  }

  function overview() {
    focused = null;
    docker.show(docker.containers.graph());
  }

  function details(name) {
    if (name) focused = name;
    else if (!focused) return overview();
    docker.show(docker.containers.subgraph(focused));
  }

  function sigcontainers(c) {
    docker.containers.set(c)
    if (sigcontainer) sigcontainer()
  }
  
  function sigvolumes(c) {
    docker.volumes.set(c)
    if (sigcontainer) sigcontainer()
  }
  
  function signodes(c) {
    docker.nodes.set(c)
    if (sigstack) sigstack()
  }
  
  function sigservices(c) {
    docker.services.set(c)
    if (sigstack) sigstack()
  }
  
  function sigtasks(c) {
    docker.tasks.set(c)
    if (sigstack) sigstack()
  }
  
  var laststats=null;
  function stats(data) {
    if (!data) return;
    var lines = data.split("\n");
    var head = lines.shift();
    lines.forEach(function(line) {
      if (!line) return;
      elements = line.split(/ +/);
      $(container_element+' title:contains("'+elements[0]+'")')
        .filter(function() {return $(this).text() === elements[0]})
        .next().children('a')
        .attr('xlink:title',
              'cpu: '+elements[1]+'\n'
             +'mem: '+elements[7]+'\n'
             +'net: '+elements[8]+elements[9]+' '+elements[11]+elements[12]+'\n'
             +'block: '+elements[13]+elements[14]+' '+elements[16]+elements[17])
      /*
         $(container_element+' text + text:contains("'+elements[0]+'") + text + text')
        .html('cpu: '+elements[1]+' mem: '+elements[7]);
         $(container_element+' text + text:contains("'+elements[0]+'") + text')
        .html('net: '+elements[8]+elements[9]+' '+elements[11]+elements[12]
             +' block: '+elements[13]+elements[14]+' '+elements[16]+elements[17]);
      */
    });
  }

  socket
    .on("docker.fail", error)
    .on("docker.containers", sigcontainers)
    .on("docker.volumes", sigvolumes)
    .on("docker.nodes", signodes)
    .on("docker.services", sigservices)
    .on("docker.tasks", sigtasks)
    //.on("docker.stats", stats)
  emit("docker.containers")
  emit("docker.volumes")
  emit("docker.nodes")
  emit("docker.services")
  emit("docker.tasks")
}

if (typeof module === 'undefined') module = {};
module.exports = {
  Docker: Docker
}
