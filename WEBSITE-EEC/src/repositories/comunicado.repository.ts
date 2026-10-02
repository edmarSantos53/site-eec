import type { SupabaseClient } from '@supabase/supabase-js'
import { getDatabase } from '../database/connection'

export interface ComunicadoRecord {
    id: number
    titulo: string
    conteudo: string
    status: 'rascunho' | 'publicado' | 'arquivado'
    audiencia: 'todos_internos' | 'admin_secretaria' | 'docentes' | 'admin_tecnico'
    criado_por: string
    publicado_em: string | null
    arquivado_em: string | null
    created_at: string
    updated_at: string
}

export interface CreateComunicadoDTO {
    titulo: string
    conteudo: string
    status: 'rascunho' | 'publicado' | 'arquivado'
    audiencia: 'todos_internos' | 'admin_secretaria' | 'docentes' | 'admin_tecnico'
    criado_por: string
    publicado_em?: string | null
}

export async function listComunicados(
    client?: SupabaseClient | null,
    userRole?: string,
    userId?: string
): Promise<ComunicadoRecord[]> {
    // 1. Em ambiente Cloud / Produção: consulta via cliente Supabase (RLS ativo)
    if (client) {
        const { data, error } = await client
            .from('comunicados')
            .select('*')
            .order('id', { ascending: false })

        if (error) {
            throw new Error(`Erro ao consultar comunicados no Supabase: ${error.message}`)
        }

        return (data || []) as ComunicadoRecord[]
    }

    // 2. Em ambiente local / testes isolados (SQLite): aplica as mesmas regras de visibilidade
    const db = getDatabase()

    if (userRole === 'super_admin' || userRole === 'admin') {
        const stmt = db.prepare('SELECT * FROM comunicados ORDER BY id DESC')
        return (stmt.all() as unknown) as ComunicadoRecord[]
    }

    if (userRole === 'secretaria') {
        const stmt = db.prepare(`
            SELECT * FROM comunicados 
            WHERE (status = 'publicado' AND audiencia IN ('todos_internos', 'admin_secretaria'))
               OR (criado_por = ?)
            ORDER BY id DESC
        `)
        return (stmt.all(userId || '') as unknown) as ComunicadoRecord[]
    }

    if (userRole === 'docente') {
        const stmt = db.prepare(`
            SELECT * FROM comunicados 
            WHERE (status = 'publicado' AND audiencia IN ('todos_internos', 'docentes'))
               OR (criado_por = ?)
            ORDER BY id DESC
        `)
        return (stmt.all(userId || '') as unknown) as ComunicadoRecord[]
    }

    if (userRole === 'admin_tecnico') {
        const stmt = db.prepare(`
            SELECT * FROM comunicados 
            WHERE status = 'publicado' AND audiencia IN ('todos_internos', 'admin_tecnico')
            ORDER BY id DESC
        `)
        return (stmt.all() as unknown) as ComunicadoRecord[]
    }

    return []
}

export async function findComunicadoById(
    id: number,
    client?: SupabaseClient | null
): Promise<ComunicadoRecord | null> {
    if (client) {
        const { data, error } = await client
            .from('comunicados')
            .select('*')
            .eq('id', id)
            .maybeSingle()

        if (error) {
            throw new Error(`Erro ao buscar comunicado: ${error.message}`)
        }

        return (data as ComunicadoRecord) || null
    }

    const db = getDatabase()
    const row = db.prepare('SELECT * FROM comunicados WHERE id = ?').get(id)
    return ((row as unknown) as ComunicadoRecord) || null
}

export async function createComunicado(
    data: CreateComunicadoDTO,
    client?: SupabaseClient | null
): Promise<ComunicadoRecord> {
    if (client) {
        const { data: created, error } = await client
            .from('comunicados')
            .insert({
                titulo: data.titulo,
                conteudo: data.conteudo,
                status: data.status,
                audiencia: data.audiencia,
                criado_por: data.criado_por,
                publicado_em: data.publicado_em || null
            })
            .select()
            .single()

        if (error) {
            throw new Error(`Erro ao criar comunicado no Supabase: ${error.message}`)
        }

        return created as ComunicadoRecord
    }

    const db = getDatabase()
    const stmt = db.prepare(`
        INSERT INTO comunicados (titulo, conteudo, status, audiencia, criado_por, publicado_em)
        VALUES (?, ?, ?, ?, ?, ?)
    `)
    const info = stmt.run(
        data.titulo,
        data.conteudo,
        data.status,
        data.audiencia,
        data.criado_por,
        data.publicado_em || null
    )

    const selectStmt = db.prepare('SELECT * FROM comunicados WHERE id = ?')
    return (selectStmt.get(info.lastInsertRowid) as unknown) as ComunicadoRecord
}

export async function updateComunicadoStatus(
    id: number,
    newStatus: 'publicado' | 'arquivado',
    client?: SupabaseClient | null
): Promise<void> {
    const nowIso = new Date().toISOString()
    const updatePayload: Record<string, string> = {
        status: newStatus,
        updated_at: nowIso
    }

    if (newStatus === 'publicado') {
        updatePayload.publicado_em = nowIso
    } else if (newStatus === 'arquivado') {
        updatePayload.arquivado_em = nowIso
    }

    if (client) {
        const { error } = await client
            .from('comunicados')
            .update(updatePayload)
            .eq('id', id)

        if (error) {
            throw new Error(`Erro ao atualizar status do comunicado: ${error.message}`)
        }
        return
    }

    const db = getDatabase()
    if (newStatus === 'publicado') {
        db.prepare('UPDATE comunicados SET status = ?, publicado_em = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
            .run(newStatus, id)
    } else {
        db.prepare('UPDATE comunicados SET status = ?, arquivado_em = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
            .run(newStatus, id)
    }
}
