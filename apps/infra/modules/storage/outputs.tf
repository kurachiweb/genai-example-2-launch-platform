output "database_ids" {
  value = { for k, d in cloudflare_d1_database.this : k => d.id }
}

output "bucket_names" {
  value = { for k, b in cloudflare_r2_bucket.this : k => b.name }
}

output "placement" {
  value = {
    account_ids   = toset(concat([for d in cloudflare_d1_database.this : d.account_id], [for b in cloudflare_r2_bucket.this : b.account_id]))
    jurisdictions = toset(concat([for d in cloudflare_d1_database.this : d.jurisdiction], [for b in cloudflare_r2_bucket.this : b.jurisdiction]))
  }
}
