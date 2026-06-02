from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.core.knowledge_base import build_rag_context, retrieve_relevant_documents, truncate_content
from app.models.knowledge_base import KnowledgeBaseDocument
from app.models.user import User
from app.utils.schemas import (
    KnowledgeBaseDocumentCreateRequest,
    KnowledgeBaseDocumentResponse,
    KnowledgeBaseDocumentUpdateRequest,
    KnowledgeBaseRagContextResponse,
)

router = APIRouter(prefix="/api/knowledge-base", tags=["knowledge-base"])


@router.get("/documents", response_model=list[KnowledgeBaseDocumentResponse])
def list_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[KnowledgeBaseDocumentResponse]:
    docs = (
        db.query(KnowledgeBaseDocument)
        .filter(KnowledgeBaseDocument.user_id == current_user.id)
        .order_by(KnowledgeBaseDocument.updated_at.desc())
        .all()
    )
    return [_serialize_document(doc) for doc in docs]


@router.post("/documents", response_model=KnowledgeBaseDocumentResponse)
def create_document(
    payload: KnowledgeBaseDocumentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseDocumentResponse:
    content = truncate_content(payload.content)
    doc = KnowledgeBaseDocument(
        user_id=current_user.id,
        title=payload.title,
        content=content,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _serialize_document(doc)


@router.patch("/documents/{doc_id}", response_model=KnowledgeBaseDocumentResponse)
def update_document(
    doc_id: int,
    payload: KnowledgeBaseDocumentUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseDocumentResponse:
    doc = (
        db.query(KnowledgeBaseDocument)
        .filter(KnowledgeBaseDocument.id == doc_id, KnowledgeBaseDocument.user_id == current_user.id)
        .first()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.title is not None:
        doc.title = payload.title
    if payload.content is not None:
        doc.content = truncate_content(payload.content)

    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _serialize_document(doc)


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    doc = (
        db.query(KnowledgeBaseDocument)
        .filter(KnowledgeBaseDocument.id == doc_id, KnowledgeBaseDocument.user_id == current_user.id)
        .first()
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    db.delete(doc)
    db.commit()
    return {"status": "ok"}


@router.get("/rag-context", response_model=KnowledgeBaseRagContextResponse)
def get_rag_context(
    query: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KnowledgeBaseRagContextResponse:
    docs = retrieve_relevant_documents(db, current_user.id, query)
    context = build_rag_context(docs, query)
    return KnowledgeBaseRagContextResponse(context=context, document_count=len(docs))


def _serialize_document(doc: KnowledgeBaseDocument) -> KnowledgeBaseDocumentResponse:
    return KnowledgeBaseDocumentResponse(
        id=doc.id,
        user_id=doc.user_id,
        title=doc.title,
        content=doc.content,
        created_at=doc.created_at.isoformat() if doc.created_at else None,
        updated_at=doc.updated_at.isoformat() if doc.updated_at else None,
    )
