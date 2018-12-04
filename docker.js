var Docker = function(socket, error, sigstack, sigcontainer) {

  var focused = null
  var viz = null
  var vizmore = null
  var rankdir = "LR"
  var paused = false
  var docker = this

  function emit(signal, data) {
    socket.emit(signal, data)
  }

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

    function evalPorts(ports, name) {
      var res = ''
      var firstport = null
      var lastport = null
      ports.sort((a, b) => {
        var puba = a.PublishedPort || a.PublicPort
        var pubb = b.PublishedPort || b.PublicPort
        return puba - pubb
      }).forEach((p) => {
        var pub = p.PublishedPort || p.PublicPort
        if (pub) {
          if (lastport) {
            var lastpub = lastport.PublishedPort || lastport.PublicPort
            var firstpub = firstport.PublishedPort || firstport.PublicPort
            var firstpriv = firstport.TargetPort || firstport.PrivatePort
            var lastpriv = lastport.TargetPort || lastport.PrivatePort
            var proto = firstport.Protocol || firstport.Type
            var newproto = p.Protocol || p.Type
            if (proto!=newproto || pub>lastpub+1) {
              if (firstpub==lastpub)
                res += "      \""+firstpub+"\";\n"
                    +  "      \""+firstpub+"\" -> \""
                    +  name
                    +  "\" [label=\""+firstpriv+'/'+proto+"\"];\n"
              else
                res += "      \""+firstpub+"-"+lastpub+"\";\n"
                    +  "      \""+firstpub+"-"+lastpub+"\" -> \""
                    +  name
                    +  "\" [label=\""+firstpriv+"-"+lastpriv+'/'+proto+"\"];\n"
              firstport = lastport = p
            } else {
              lastport = p
            }
          } else {
            firstport = lastport = p
          }
        }
      })
      if (firstport) {
        var lastpub = lastport.PublishedPort || lastport.PublicPort
        var firstpub = firstport.PublishedPort || firstport.PublicPort
        var firstpriv = firstport.TargetPort || firstport.PrivatePort
        var lastpriv = lastport.TargetPort || lastport.PrivatePort
        var proto = firstport.Protocol || firstport.Type
        if (firstpub) {
          if (firstpub==lastpub)
            res += "      \""+firstpub+"\";\n"
                +  "      \""+firstpub+"\" -> \""
                +  name
                +  "\" [label=\""+firstpriv+'/'+proto+"\"];\n"
          else
            res += "      \""+firstpub+"-"+lastpub+"\";\n"
                +  "      \""+firstpub+"-"+lastpub+"\" -> \""
                +  name
                +  "\" [label=\""+firstpriv+"-"+lastpriv+'/'+proto+"\"];\n"
        }
      }
      return res
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

    // draw all standalone docker containers (not member of a stack)
    this.standalone = (colors = this.colors) => {
      var containers = docker.containers.get()
      var usedvolumes = new Set()
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
        res += evalPorts(c.Ports, c.Id)
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
              if (!m.Source) {
                usedvolumes.add(m.Name)
              } else {
                res += '  "'+m.Name+'" [shape=box,label="'+m.Source+'"];\n'
                    +  '  "'+c.Id+'" -> "'+m.Name
                    +  '" [style=dashed,label=<'+m.Destination+'<font point-size="10">:'+(m.RW?'rw':'ro')+'</font>>];\n'
              }
            } break
          }
        })
      })
      // handle volumes-from
      usedvolumes.forEach((volname) => {
        var m = null
        var cs = containers.filter((p) => {
          return p.Mounts && p.Mounts.find((pm) => {
            if (pm.Type=='volume' && pm.Name==volname) {
              m = pm
              return true
            }
            return false
          })
        })
        switch (cs.length) {
          case 0: {
            console.log('ERROR: CONTAINER VANISHED!') // theoretically impossible, wanna see
          } break
          case 1: {
            // own data, ignored
          } break
          default: {
            var first = cs.pop()
            cs.forEach((c) => {
              res += '  "'+c.Id+'" -> "'+first.Id
                  +  '" [dir=none,style=dashed,label=<'+m.Destination+'<font point-size="10">:'
                  +  (m.RW?'rw':'ro')+'</font>>];\n'
            })
          }
        }
      })
      return res
    }
    
    // draw all docker stacks
    this.stack = (colors = this.colors) => {
      var res = ''
      var nodes = docker.nodes.get()
      var services = docker.services.get()
      var tasks = docker.tasks.get()
      var stacks = services.map((s) => {
        return s.Spec.Labels['com.docker.stack.namespace']
      }).filter((s, i, a) => {
        return a.indexOf(s) === i
      })
      // ports
      services.forEach((s) => {
        if (s.Endpoint && s.Endpoint.Ports)
          res += evalPorts(s.Endpoint.Ports, s.Spec.Labels['com.docker.stack.namespace'])
      })
      // stacks
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
      // nodes
      if (nodes.length)
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
            services.filter((s) => {
              return s.ID == p.ServiceID
            }).forEach((s) => {
              res += s.Spec.Name.replace(st+'_', '')
            })
            res += "</TD><TD "+color+">"+p.Status.State
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
      })
      if (nodes.length)
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
      // add port forwarding as specified in label 'forwards'
      var ports = {}
      services.forEach((s) => {
        if (s.Endpoint && s.Endpoint.Ports)
          s.Endpoint.Ports.forEach((p) => {
            ports[p.PublishedPort] = s
          })
      })
      services.forEach((s) => {
        if (s.Spec.TaskTemplate.ContainerSpec.Labels['forwards'])
          s.Spec.TaskTemplate.ContainerSpec.Labels['forwards'].split(' ').forEach((port) => {
            var other = ports[port]
            if (other) {                         
              res += "      \""+s.Spec.Labels['com.docker.stack.namespace']
                  +  "\" -> \""+port+"\";\n"
              if (other.Spec.TaskTemplate.ContainerSpec.Labels['url'])
                res += "      \""+other.Spec.TaskTemplate.ContainerSpec.Labels['url']
                    +  "\" [href=\""
                    +  other.Spec.TaskTemplate.ContainerSpec.Labels['url']
                    +  "\"];\n      \""
                    +  other.Spec.TaskTemplate.ContainerSpec.Labels['url']
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
            a[i] = ("000"+(i+1)).slice(-3)+": "+v
          })
        throw({'msg': 'viz → '+e, 'data': codelines.join("\n")})
      }
    }
  }

  this.upload = (data) => {
    if (!data || !data.containers || !data.volumes || !data.nodes || !data.services || !data.tasks)
      return false
    docker.pause()
    docker.containers.set(data.containers)
    docker.volumes.set(data.volumes)
    docker.nodes.set(data.nodes)
    docker.services.set(data.services)
    docker.tasks.set(data.tasks)
    if (sigstack) sigstack();
    if (sigcontainer) sigcontainer();
    return true
  }

  this.pause = () => {
    docker.paused = true
  }

  this.unpause = () => {
    docker.paused = false
    emit("docker.containers")
    emit("docker.volumes")
    emit("docker.nodes")
    emit("docker.services")
    emit("docker.tasks")
    emit("docker.images")
  }

  this.Storage = function() {

    var storage = []

    this.get = () => {
      return storage
    }

    this.set = (c) => {
      if (typeof c == "string") c = JSON.parse(c);
      if (typeof c != "object") throw {'msg': "storage → wrong format: "+(typeof c), 'data': c};
      storage = c;
    }
    
  }

  this.graphics = new Graphics()
  this.volumes = new this.Storage()
  this.containers = new this.Storage()
  this.services = new this.Storage()
  this.tasks = new this.Storage()
  this.images = new this.Storage();
  this.nodes = new this.Storage()

  function sigcontainers(c) {
    if (docker.paused) return;
    docker.containers.set(c)
    if (sigcontainer) sigcontainer()
  }
  
  function sigvolumes(c) {
    if (docker.paused) return;
    docker.volumes.set(c)
    if (sigcontainer) sigcontainer()
  }
  
  function signodes(c) {
    if (docker.paused) return;
    docker.nodes.set(c)
    if (sigstack) sigstack()
  }
  
  function sigservices(c) {
    if (docker.paused) return;
    docker.services.set(c)
    if (sigstack) sigstack()
  }
  
  function sigtasks(c) {
    if (docker.paused) return;
    docker.tasks.set(c)
    if (sigstack) sigstack()
  }

  function sigimages(c) {
    if (docker.paused) return;
    docker.images.set(c)
  }

  socket
    .on("docker.fail", error)
    .on("docker.containers", sigcontainers)
    .on("docker.volumes", sigvolumes)
    .on("docker.nodes", signodes)
    .on("docker.services", sigservices)
    .on("docker.tasks", sigtasks)
    .on("docker.images", sigimages)
  docker.unpause()
}

if (typeof module === 'undefined') module = {};
module.exports = {
  Docker: Docker
}
