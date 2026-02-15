/**
 * API service for content relationship operations.
 */
import { api } from './api'
import type {
  Relationship,
  RelationshipCreate,
  RelationshipUpdate,
  RelationshipListResponse,
  ContentType,
  RelationshipType,
} from '../types'

export const relationshipsApi = {
  create: (data: RelationshipCreate) =>
    api.post<Relationship>('/relationships/', data),

  get: (id: string) =>
    api.get<Relationship>(`/relationships/${id}`),

  update: (id: string, data: RelationshipUpdate) =>
    api.patch<Relationship>(`/relationships/${id}`, data),

  delete: (id: string) =>
    api.delete(`/relationships/${id}`),

  getForContent: (
    contentType: ContentType,
    contentId: string,
    params?: {
      relationship_type?: RelationshipType
      include_content_info?: boolean
    }
  ) => api.get<RelationshipListResponse>(
    `/relationships/content/${contentType}/${contentId}`,
    { params },
  ),
}
