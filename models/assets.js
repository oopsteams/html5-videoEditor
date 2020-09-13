var mongo = require('mongojs'),
    db = mongo('videoProjects', ['assets']),
    files = null;


exports.init = function (files) {
    "use strict";
    this.files = files;
    return this;
};

exports.create = function (data, callback) {
    db.assets.save(data, function saveCallback(err, docs) {
            console.log('ASSET.JS::CREATED', docs._id);
            if (err) throw err;
            callback(err, docs);
        }
    );
};

exports.read = function (data, callback) {
	console.log("will to read assets:", data);
    db.assets.findOne({_id : db.ObjectId(data._id)}, function onFound(err, docs) {
        console.log('ASSET.JS::FOUND', docs._id);
        if (err) throw err;
        callback(err, docs);
    });

};

exports.update = function (data, callback) {
    var id = data._id;
<<<<<<< HEAD
    //delete data._id;
	console.log("will to update assets:", data);
    db.assets.update({_id : db.ObjectId(id)}, {$set:data}, {multi : false},
=======
    delete data._id;
    console.log("will to update assets:", data);
    db.assets.update({_id : db.ObjectId(id)},{$set: data}, {multi : false},
>>>>>>> 014d1f008732162e07dfecd642ec0e711bdeab1c
        function updateCallback(err, docs) {
            data._id = id;
            if (err) throw err;
            callback(err, {});
        }

    )
    ;

};

exports.remove = function (data, callback) {

    var id = db.ObjectId(data._id);

    db.assets.remove({_id : id}, function deleteCallback(err, docs) {
        console.log('ASSET.JS::REMOVED', id);
        if (err) throw err;

        callback(err, docs);
    });

};


exports.getLibraryByProjectId = function (data, callback) {
    db.assets.find({projectId : data.id}, function onFound(err, docs) {
        console.log('PROJECTS.JS::LIBRARY SERVED WITH', docs.length, 'ASSETS');
        if (err) throw err;
        callback(err, docs);
    });
};

exports.getAssetByFileId = function (fileId, callback) {
    'use strict';

    db.assets.findOne({files : {$all : [fileId]}}, function onFound(err, docs) {
            if (err) throw err;
            callback(docs);
        }
    );
};
