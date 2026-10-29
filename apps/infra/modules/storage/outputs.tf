output "database_ids" {
  value = { for k, d in cloudflare_d1_database.this : k => d.id }
}

output "bucket_names" {
  value = { for k, b in cloudflare_r2_bucket.this : k => b.name }
}
