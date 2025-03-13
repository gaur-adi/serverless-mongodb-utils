import { MongoClient, ObjectId, type Collection, type Db, type Document } from 'mongodb'
import * as httpContext from 'express-http-context'
import { auditRecord } from './audit/audit'

const url = process.env.MONGODB_URL ?? ''
const dbName = process.env.MONGODB_DB_NAME ?? ''
let cachedDb: Db | null = null

// connect to db
export const connectToDb = async (): Promise<Db> => {
  if (cachedDb != null) {
    return cachedDb
  }

  const client = await MongoClient.connect(url)
  const db = client.db(dbName)

  cachedDb = db
  return db
}

export const getCollection = async (collectionName: string): Promise<Collection<Document>> => {
  const db = await connectToDb()
  const collection = db.collection(collectionName)
  console.log(`Got collection with the name '${collection.collectionName}'`)
  return collection
}

export const findById = async <T extends Document>(collectionName: string, id: string): Promise<T | null> => {
  const collection = await getCollection(collectionName)
  const document = await collection.findOne({ _id: new ObjectId(id) }) as T | null
  return document
}

export const findByIds = async <T extends Document>(collectionName: string, ids: string[], query?: Record<string, unknown>): Promise<T[]> => {
  const collection = await getCollection(collectionName)
  const documents = await collection.find({ _id: { $in: ids.map(id => new ObjectId(id)) }, ...query }).toArray() as unknown as T[]
  return documents
}

// find one document or return null
export const findOne = async <T extends Document>(collectionName: string, query?: Record<string, unknown>): Promise<T | null> => {
  const collection = await getCollection(collectionName)
  const document = await collection.findOne({ ...query }) as T | null
  return document
}

export const findOneOrFail = async <T extends Document>(collectionName: string, query?: Record<string, unknown>): Promise<T> => {
  const collection = await getCollection(collectionName)
  const document = await collection.findOne({ ...query }) as T | null

  if (document == null) {
    throw new Error(`No document matches ${Object.keys(query ?? {}).join(', ')}`)
  }

  return document
}

export const find = async <T extends Document>(collectionName: string, query: Record<string, unknown>, page?: number, pageSize?: number): Promise<T[]> => {
  const collection = await getCollection(collectionName)
  const skip = ((page != null) ? page - 1 : 0) * (pageSize ?? 50)
  const documents = await collection.find({ ...query }).sort({ _id: -1 }).skip(skip).limit(pageSize ?? 50).toArray() as unknown as T[]
  return documents
}

export const runAggregation = async <T extends Document>(collectionName: string, pipeline: object[]): Promise<T[]> => {
  const collection = await getCollection(collectionName)
  const result = await collection.aggregate(pipeline).toArray()
  return result as T[]
}

export const deleteDocuments = async (collectionName: string, query?: Record<string, unknown> | string[], failIfNoMatch: boolean = false): Promise<void> => {
  const collection = await getCollection(collectionName)
  let deleteResult

  if (Array.isArray(query)) {
    deleteResult = await collection.deleteMany({ _id: { $in: query.map(id => new ObjectId(id)) } })
  } else {
    deleteResult = await collection.deleteOne(query ?? {})
  }

  const userLogin = getUserLogin()
  const userId = userLogin?.user?._id ?? 'SYSTEM'
  const userName = userLogin?.user?.email ?? 'SYSTEM'
  await auditRecord(userId, userName, 'DELETE', JSON.stringify(query), new Date(), collectionName)

  if (failIfNoMatch && deleteResult.deletedCount === 0) {
    throw new Error('NO_MATCH' + JSON.stringify(query))
  }
}

// save a document
export const save = async <T extends Document & { _id?: any }>(collectionName: string, document: T | T[]): Promise<T | T[]> => {
  const collection = await getCollection(collectionName)
  const userLogin = getUserLogin()
  const userId = userLogin?.user?._id ?? 'SYSTEM'
  const userName = userLogin?.user?.email ?? 'SYSTEM'

  if (Array.isArray(document)) {
    for (const doc of document) {
      const { _id, ...rest } = doc
      if (_id !== undefined && _id !== null) {
        await collection.updateOne({ _id: new ObjectId(String(_id)) }, { $set: rest }, { upsert: true })
        await auditRecord(userId, userName, 'UPDATE', _id, new Date(), collectionName)
      } else {
        const insertResult = await collection.insertOne(doc)
        await auditRecord(userId, userName, 'INSERT', insertResult.insertedId.toHexString(), new Date(), collectionName)
      }
    }
  } else {
    const { _id, ...rest } = document
    if (_id !== undefined && _id !== null) {
      await collection.updateOne({ _id: new ObjectId(String(_id)) }, { $set: rest }, { upsert: true })
      await auditRecord(userId, userName, 'UPDATE', _id, new Date(), collectionName)
    } else {
      const result = await collection.insertOne(document)
      await auditRecord(userId, userName, 'INSERT', result.insertedId.toHexString(), new Date(), collectionName)
    }
  }

  return document
}

export const countDocuments = async (collectionName: string, query?: Record<string, unknown>): Promise<number> => {
  const collection = await getCollection(collectionName)
  const count = await collection.countDocuments({ ...query })
  return count
}

export const getUserLogin = (): any => {
  return httpContext.get('userLogin')
}
