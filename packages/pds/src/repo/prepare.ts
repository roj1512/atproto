import { AtUri } from '@atproto/uri'
import { cidForCbor, TID } from '@atproto/common'
import {
  PreparedCreate,
  PreparedUpdate,
  PreparedDelete,
  ImageConstraint,
  InvalidRecordError,
  PreparedWrite,
  PreparedBlobRef,
} from './types'

import * as lex from '../lexicon/lexicons'
import {
  LexiconDefNotFoundError,
  LexValue,
  lexValueToIpld,
} from '@atproto/lexicon'
import {
  RecordDeleteOp,
  RecordCreateOp,
  RecordUpdateOp,
  RecordWriteOp,
  WriteOpAction,
} from '@atproto/repo'
import { CID } from 'multiformats/cid'

// @TODO do this dynamically off of schemas
export const blobsForWrite = (record: any): PreparedBlobRef[] => {
  if (record.$type === lex.ids.AppBskyActorProfile) {
    const doc = lex.schemaDict.AppBskyActorProfile
    const refs: PreparedBlobRef[] = []
    if (record.avatar) {
      refs.push({
        cid: record.avatar.ref,
        mimeType: record.avatar.mimeType,
        constraints: doc.defs.main.record.properties.avatar as ImageConstraint,
      })
    }
    if (record.banner) {
      refs.push({
        cid: record.banner.ref,
        mimeType: record.banner.mimeType,
        constraints: doc.defs.main.record.properties.banner as ImageConstraint,
      })
    }
    return refs
  } else if (record.$type === lex.ids.AppBskyFeedPost) {
    const refs: PreparedBlobRef[] = []
    const embed = record?.embed
    if (embed?.$type === 'app.bsky.embed.images') {
      const doc = lex.schemaDict.AppBskyEmbedImages
      for (let i = 0; i < embed.images?.length || 0; i++) {
        const img = embed.images[i]
        refs.push({
          cid: img.image.ref,
          mimeType: img.image.mimeType,
          constraints: doc.defs.image.properties.image as ImageConstraint,
        })
      }
    } else if (
      record?.embed?.$type === 'app.bsky.embed.external' &&
      embed.external.thumb
    ) {
      const doc = lex.schemaDict.AppBskyEmbedExternal
      refs.push({
        cid: embed.external.thumb.ref,
        mimeType: embed.external.thumb.mimeType,
        constraints: doc.defs.external.properties.thumb as ImageConstraint,
      })
    }
    return refs
  }
  return []
}

export const assertValidRecord = (record: Record<string, unknown>) => {
  if (typeof record.$type !== 'string') {
    throw new InvalidRecordError('No $type provided')
  }
  try {
    lex.lexicons.assertValidRecord(record.$type, record)
  } catch (e) {
    if (e instanceof LexiconDefNotFoundError) {
      throw new InvalidRecordError(e.message)
    }
    throw new InvalidRecordError(
      `Invalid ${record.$type} record: ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }
}

export const setCollectionName = (
  collection: string,
  record: Record<string, unknown>,
  validate: boolean,
) => {
  if (!record.$type) {
    record.$type = collection
  }
  if (validate && record.$type !== collection) {
    throw new InvalidRecordError(
      `Invalid $type: expected ${collection}, got ${record.$type}`,
    )
  }
  return record
}

export const determineRkey = (collection: string): string => {
  const doc = lex.lexicons.getDef(collection)
  let keyType: string | undefined
  if (doc && doc.type === 'record') {
    keyType = doc.key
  }
  if (keyType && keyType.startsWith('literal')) {
    const split = keyType.split(':')
    return split[1]
  } else {
    return TID.nextStr()
  }
}

export const prepareCreate = async (opts: {
  did: string
  collection: string
  record: Record<string, unknown>
  rkey?: string
  validate?: boolean
}): Promise<PreparedCreate> => {
  const { did, collection, validate = true } = opts
  const record = setCollectionName(collection, opts.record, validate)
  if (validate) {
    assertValidRecord(record)
  }
  const rkey = opts.rkey || determineRkey(collection)
  return {
    action: WriteOpAction.Create,
    uri: AtUri.make(did, collection, rkey),
    cid: await cidForRecord(record),
    record,
    blobs: blobsForWrite(record),
  }
}

export const prepareUpdate = async (opts: {
  did: string
  collection: string
  rkey: string
  record: Record<string, unknown>
  validate?: boolean
}): Promise<PreparedUpdate> => {
  const { did, collection, rkey, validate = true } = opts
  const record = setCollectionName(collection, opts.record, validate)
  if (validate) {
    assertValidRecord(record)
  }
  return {
    action: WriteOpAction.Update,
    uri: AtUri.make(did, collection, rkey),
    cid: await cidForRecord(record),
    record,
    blobs: blobsForWrite(record),
  }
}

export const prepareDelete = (opts: {
  did: string
  collection: string
  rkey: string
}): PreparedDelete => {
  const { did, collection, rkey } = opts
  return {
    action: WriteOpAction.Delete,
    uri: AtUri.make(did, collection, rkey),
  }
}

const cidForRecord = async (record: Record<string, unknown>): Promise<CID> => {
  return cidForCbor(lexToRecord(record))
}

// @TODO better types around this stuff, but we know this is safe
const lexToRecord = (
  record: Record<string, unknown>,
): Record<string, unknown> => {
  return lexValueToIpld(record as LexValue) as Record<string, unknown>
}

export const createWriteToOp = (write: PreparedCreate): RecordCreateOp => ({
  action: WriteOpAction.Create,
  collection: write.uri.collection,
  rkey: write.uri.rkey,
  record: lexToRecord(write.record),
})

export const updateWriteToOp = (write: PreparedUpdate): RecordUpdateOp => ({
  action: WriteOpAction.Update,
  collection: write.uri.collection,
  rkey: write.uri.rkey,
  record: lexToRecord(write.record),
})

export const deleteWriteToOp = (write: PreparedDelete): RecordDeleteOp => ({
  action: WriteOpAction.Delete,
  collection: write.uri.collection,
  rkey: write.uri.rkey,
})

export const writeToOp = (write: PreparedWrite): RecordWriteOp => {
  switch (write.action) {
    case WriteOpAction.Create:
      return createWriteToOp(write)
    case WriteOpAction.Update:
      return updateWriteToOp(write)
    case WriteOpAction.Delete:
      return deleteWriteToOp(write)
    default:
      throw new Error(`Unrecognized action: ${write}`)
  }
}
