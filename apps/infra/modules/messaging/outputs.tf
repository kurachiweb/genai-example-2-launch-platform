output "queue_ids" {
  value = { for k, q in cloudflare_queue.this : k => q.queue_id }
}

output "placement" {
  value = {
    account_ids   = toset([for q in cloudflare_queue.this : q.account_id])
    jurisdictions = toset([for q in cloudflare_queue.this : q.jurisdiction])
  }
}
