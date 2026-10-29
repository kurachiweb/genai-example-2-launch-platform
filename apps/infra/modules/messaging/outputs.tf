output "queue_ids" {
  value = { for k, q in cloudflare_queue.this : k => q.queue_id }
}
