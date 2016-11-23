module.exports = function(app) {
    
    if (app) app.get('/docker/docker.js', function(req, res) {
        res.sendfile('docker.js', {root: __dirname});
    });
    
    return require(__dirname+'/docker.js');
}
