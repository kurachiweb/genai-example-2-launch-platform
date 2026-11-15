CREATE VIRTUAL TABLE help_article_search_documents_fts USING fts5(
  title, subtitle, keywords,
  content='help_article_search_documents', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER help_article_search_documents_fts_ai AFTER INSERT ON help_article_search_documents BEGIN
  INSERT INTO help_article_search_documents_fts(rowid, title, subtitle, keywords) VALUES (new.id, new.title, new.subtitle, new.keywords);
END;
--> statement-breakpoint
CREATE TRIGGER help_article_search_documents_fts_ad AFTER DELETE ON help_article_search_documents BEGIN
  INSERT INTO help_article_search_documents_fts(help_article_search_documents_fts, rowid, title, subtitle, keywords) VALUES ('delete', old.id, old.title, old.subtitle, old.keywords);
END;
--> statement-breakpoint
CREATE TRIGGER help_article_search_documents_fts_au AFTER UPDATE OF title, subtitle, keywords ON help_article_search_documents BEGIN
  INSERT INTO help_article_search_documents_fts(help_article_search_documents_fts, rowid, title, subtitle, keywords) VALUES ('delete', old.id, old.title, old.subtitle, old.keywords);
  INSERT INTO help_article_search_documents_fts(rowid, title, subtitle, keywords) VALUES (new.id, new.title, new.subtitle, new.keywords);
END;
