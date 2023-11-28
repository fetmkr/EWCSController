import Nano  from 'nano'

let nano = Nano('http://admin:ewcs@127.0.0.1:5984')

function DB() {
  let _db = null;
  
  // create db for the first time else connect to the db
  const create = async (dbName) => {
    const dbList = await list();
    try {
      //console.log(dbList)
      if(!dbList.includes(dbName)) {
        await nano.db.create(dbName);
        const db = nano.use(dbName);
        console.log('database created')
        _db = db;
        return db;
      } else {
        const db = nano.use(dbName);
        console.log(`connected to ${dbName} database`)
        _db = db;
        return db;
      }
    } catch (err) {
      console.log('error connect to database')
      _db = null;
      throw new Error(err)
    }
  }
  
  const destory = async (dbName) => {
    await nano.db.destroy(dbName);
  }
  
  const list = async () => {
    const dbList = await nano.db.list();
    return dbList
  }
  
  const info = (db) => {
    db.info().then(console.log)
  }
  
  const insert_doc = async (db, doc) => {
    await db.insert(doc)
    return true
  }
  
  const insert_doc_async = (db, doc) => {
    db.insert(doc, async function (e, b, h) {
      if (e) {
        console.log(e.message);
        return;
      }
      //console.log(b);
      const dbinfo = await db.info()
      console.log(dbinfo.db_name + " data inserted to couchdb database at: "+ Date(Date.now()))
    
    })
  }
  
  const update_doc = async (db, id, rev, doc) => {
    await db.insert({ _id: id, _rev: rev, ...doc })
    return true
  }
  
  const get_doc = async (db, _id) => {
    const doc = await db.get(_id);
    return doc
  }
  
  const list_docs = async (db) => {
    const doclist = await db.list({ include_docs: true })
  
    doclist.rows.forEach((doc) => {
      console.log(doc);
    });
    return doclist
  }
  
  // const find_docs = async (db, _selector) => {
  //   const docs = await db.find({
  //     selector: _selector,limit: 0,
  //   });
  //   //console.log(docs)
  //   return docs
  // }

  const find_docs = async (db, query) => {
    const docs = await db.find(query);
    //console.log(docs)
    return docs
  }
  
  return {
    create: create,
    destory: destory,
    insert: insert_doc,
    insertAsync: insert_doc_async,
    update: update_doc,
    get: get_doc,
    list: list_docs,
    find: find_docs,
    info: info
  }
}

export { DB };

//db.get('foo', function (error, body, headers) { 
//  if (error) { console.error(error) } 
//  console.log(body)
//})

// https://dev.to/dnature/graphql-crud-operations-on-a-couchdb-database-with-nodejs-11ka
// https://morioh.com/p/30a8c2f03b36
// https://github.com/apache/couchdb-nano