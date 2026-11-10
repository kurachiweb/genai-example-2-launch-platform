CREATE VIRTUAL TABLE product_search_documents_fts USING fts5(
  name, tagline, keywords,
  content='product_search_documents', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER product_search_documents_fts_ai AFTER INSERT ON product_search_documents BEGIN
  INSERT INTO product_search_documents_fts(rowid, name, tagline, keywords) VALUES (new.id, new.name, new.tagline, new.keywords);
END;
--> statement-breakpoint
CREATE TRIGGER product_search_documents_fts_ad AFTER DELETE ON product_search_documents BEGIN
  INSERT INTO product_search_documents_fts(product_search_documents_fts, rowid, name, tagline, keywords) VALUES ('delete', old.id, old.name, old.tagline, old.keywords);
END;
--> statement-breakpoint
CREATE TRIGGER product_search_documents_fts_au AFTER UPDATE OF name, tagline, keywords ON product_search_documents BEGIN
  INSERT INTO product_search_documents_fts(product_search_documents_fts, rowid, name, tagline, keywords) VALUES ('delete', old.id, old.name, old.tagline, old.keywords);
  INSERT INTO product_search_documents_fts(rowid, name, tagline, keywords) VALUES (new.id, new.name, new.tagline, new.keywords);
END;
