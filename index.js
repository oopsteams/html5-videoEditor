var express = require('express'),
    app = express(),
    server = require('http').createServer(app),
    io = require('socket.io').listen(3000),
    events = require('events'),
    fs = require('fs'),
    manager = require('./modules/manager').createManager(),
    encoder = require('./modules/encoder'),
    avisynth = require('./modules/avisynth'),
    metadata = require('./modules/metadata');


/**
 * EXPRESS CONFIGURATION
 */
app.use(express.bodyParser());

app.configure(function () {
    app.use(express.static(__dirname + '/public'));
    app.use(express.errorHandler({ dumpExceptions : true, showStack : true }));

});


/**
 * SOCKET.IO CONFIGURATION
 */
io.enable('browser client minification');  // send minified client
io.enable('browser client etag');          // apply etag caching logic based on version number
io.enable('browser client gzip');          // gzip the file
io.set('log level', 1);                    // reduce logging
io.set('browser client', false);           //does Socket.IO need to serve the static resources
io.set('transports', [                     // enable all transports (optional if you want flashsocket)
    'websocket'
    , 'htmlfile'
    , 'xhr-polling'
    , 'jsonp-polling'
]);


/**
 *  OPEN PROJECT VIA PROJECT-ID
 */
app.get(new RegExp(/^\/([0-9a-fA-F]{24}$)/), function (req, res) {
    manager.projects.isProjectExistent(req.params[0], function onResponse(exists) {
        "use strict";
        if (exists) res.redirect('/#' + req.params[0]);
        else res.redirect('/');
    });
});

/**
 * OPEN COMPOSITION VIA PUBLIC-ID
 */
app.get(new RegExp(/^\/preview\/([0-9a-fA-F]{32}$)/), function (req, res) {
    manager.compositions.isPublicCompositionExistent(req.params[0], function onResponse(exists) {
        "use strict";
        if (exists)  res.redirect('/preview.html#' + req.params[0]);
        else res.redirect('/');
    });

});

/**
 * ROUTE FOR DOWNLOADING VIDEO
 */
app.get(new RegExp(/^\/projects\/.*\/compositions\/\S*|\s*/), function (req, res) {
    //there are currently only mp4s to download
    var filePath = __dirname + '/public/' + req.url + '.mp4';
    fs.exists(filePath, function (exists) {
        if (exists) {
            res.download(filePath);
        } else {
            res.writeHead(404);
            res.end('Done!');
        }
    });

});

/**
 * CLEAR ALL DATA
 */
app.get('/reset', function onReset(req, res) {
    manager.clean(function onComplete(err) {
        res.writeHead(200);
        res.end('Done!');
    });
});

/**
 * Everything else is a 404
 */
app.get('*', function (req, res) {
    res.writeHead(404);
    res.end();
});


/**
 * SOCKET.IO EVENTS
 */
io.sockets.on('connection', function (socket) {


    /*
     PROJECT CRUD
     */
    socket.on('project:create', manager.projects.create);
    socket.on('project:read', manager.projects.read);
    socket.on('project:update', manager.projects.update);
    socket.on('project:delete', manager.projects.remove);

    /*
     ASSET CRUD
     */
    socket.on('asset:create', manager.assets.create);
    socket.on('asset:read', manager.assets.read);
    socket.on('asset:update', manager.assets.update);
    socket.on('asset:delete', manager.assets.remove);

    /*
     File CRUD
     */
    socket.on('file:create', manager.files.create);
    socket.on('file:read', manager.files.read);
    socket.on('file:update', manager.files.update);
    socket.on('file:delete', function onRequest(data, callback) {
        'use strict';
        //the file gets unlinked first
        manager.removePhysicalFile(data, function onUnlinked() {
            //even if something fails, we still remove if from the db
            manager.files.remove(data, callback);
        });
    });

    /*
     COMPOSITION CRUD
     */
    socket.on('composition:create', manager.compositions.create);
    socket.on('composition:read', manager.compositions.read);
    socket.on('composition:update', manager.compositions.update);
    socket.on('composition:delete', manager.compositions.remove);

    /*
     SEQUENCE CRUD
     */
    socket.on('sequence:create', manager.sequences.create);
    socket.on('sequence:read', manager.sequences.read);
    socket.on('sequence:update', manager.sequences.update);
    socket.on('sequence:delete', manager.sequences.remove);

    /*
     COLLECTIONS FETCH
     */
    socket.on('library:read', manager.assets.getLibraryByProjectId);
    socket.on('compositions:read', manager.compositions.getCompositionsByProjectId);
    socket.on('files:read', manager.files.getFilesByAssetId);
    socket.on('sequences:read', manager.sequences.getSequencesByCompositionId);


    /*
     UPLOADER
     */

    socket.on('upload', function (data) {

        if (!data.projectId || !data.id) {
            throw new Error('Missing IDs');
        }

        //will be removed during update-process
        var fileId = data.id;

        manager.projects.getProjectPathByProjectId(data.projectId, function onPathFound(projectPath) {
            if (!projectPath) throw new Error('No folder existent for Project');

            //accept bytes an append to file
            manager.acceptFilePartial(data, projectPath, function onDataAccepted(res) {

                //inform client about progress
                socket.emit('file/' + fileId + ':update', {
                    byteOffset : res.byteOffset,
                    isComplete : res.isComplete
                });

                //save to db
                manager.files.update(res, function onUpdated(err) {
                    if (err) throw err;
                });

                //read metaData if file is complete (more accurate than clients meta)
                if (res.isComplete) {

                    var filePath = manager.getAbsoluteFilePath(projectPath, data.fileName);

                    //get the asset from the db
                    manager.assets.getAssetByFileId(fileId, function onReceived(asset) {

                        //read metadata
                        metadata.getMetaData(asset.type, filePath, function onMetaDataRead(info) {
                            //inform client
                            socket.emit('asset/' + asset._id + ':update', info);
                        });
                    });
                }
            });
        });
    });

    /*
     TRANSCODE REQUEST
     */
    socket.on('transcode', function (data) {
        "use strict";

        if (!data.projectId || !data.fileId || !data.originalFileId || !data.format) {
            throw new Error('Missing parameters for transcoding!');
        }

        var settings = {};
        settings.fileId = data.fileId;
        settings.projectId = data.projectId;
        settings.format = data.format;

        settings.fileName = null; //will be read from db
        settings.originalFileName = null;//will be read from db

        //get original fileObject
        manager.files.read({id : data.originalFileId}, function onRead(err, res) {
            "use strict";
            if (!res) return;
            settings.originalFileName = res.remoteFileName + '.' + res.ext;

            //get new fileObject
            manager.files.read({id : data.fileId}, function onRead(err, res) {
                "use strict";
                if (!res) return;
                settings.fileName = res.remoteFileName + '.' + res.ext;

                //get projectPath
                manager.projects.getProjectPathByProjectId(data.projectId, function onPathFound(projectPath) {
                    "use strict";

                    if (!projectPath) throw new Error('No assetFolder existent for Project');
                    settings.path = manager.getAbsoluteFilePath(projectPath);

                    encoder.addTranscodingJob(settings);
                    encoder.start();

                });
            });
        });
    });

    /*
     ENCODE REQUEST
     */
    socket.on('encode', function (data) {
        "use strict";

        if (!data.projectId || !data.compositionId || !data.format) {
            throw new Error('Missing parameters for encoding!');
        }

        var settings = {};
        settings.seqs = [];

        //get composition by id
        manager.compositions.read({_id : data.compositionId }, function onFound(err, docs) {

            settings.width = docs.width | 0;
            settings.height = docs.height  | 0;
            settings.fps = docs.fps;
            settings.duration = docs.duration;
            settings.fileName = docs.name + '.' + data.format.ext;
            settings.projectId = data.projectId;
            settings.compositionId = data.compositionId;

            //get all sequences that are used in the composition
            manager.sequences.getSequencesByCompositionId({id : data.compositionId}, function onFound(err, seqs) {
                //check if any sequences belong to composition
                if (seqs.length < 1) return;

                function addFileToSettings(i) {

                    if (i >= seqs.length) {
                        //complete
                        createAVSFile();
                        return;
                    }

                    var seq = seqs[i];
                    //get original files related to sequence by assetid
                    manager.files.getFilesByAssetId({id : seq.assetId}, function onFound(err, files) {

                        for (var j = 0; j < files.length; j++) {

                            if (files[j].isOriginal) {
                                //store filepath
                                seq.fileName = files[j].remoteFileName + '.' + files[j].ext;
                                settings.seqs.push(seq);

                                addFileToSettings(i + 1);
                            }
                        }
                    });
                }

                addFileToSettings(0);


                function createAVSFile() {
                    //create AVS-script
                    var avsString = avisynth.createAVSFromComposition(settings);

                    //store to disk
                    manager.projects.getProjectPathByProjectId(data.projectId, function onFound(projectFolder) {
                        var path = manager.getAbsoluteFilePath(projectFolder, data.compositionId + '.avs', 'compositions');
                        //create avisynth-file
                        fs.writeFile(path, avsString, function (err) {
                            //send to encoder
                            settings.avsPath = path;

                            encoder.addEncodingJob(settings);
                            encoder.start();
                        });

                    });
                }

            });
        });
    });

    /*
     ENCODER EVENTS
     */

    encoder.on('transcoding:progress', function onTranscodingProgress(event) {

        socket.emit('file/' + event.fileId + ':update', {
            encodingProgress : event.encodingProgress,
            isComplete       : event.isComplete
        });

        if (event.isComplete) {

            //TODO get filesize from disk
            //save to db
            manager.files.update({id : event.fileId, isComplete : true}, function onUpdated(err) {
                if (err) throw err;
            });

        }

    });

    encoder.on('encoding:progress', function onEncodingProgress(event) {
        socket.emit('composition/' + event.compositionId + ':update', {
            encodingProgress : event.encodingProgress,
            isComplete       : event.isComplete
        });

        if (event.isComplete) {

            //TODO get filesize from disk
            //save to db
            //TODO file reference
            /*
             manager.compositions.update({id : event.compositionId, status : 'Encoded', files : [] }, function onUpdated(err) {
             if (err) throw err;
             });
             */

        }

    });

})
;


app.listen(80);