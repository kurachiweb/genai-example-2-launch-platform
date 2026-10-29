output "hostnames" {
  value = { for k, d in cloudflare_workers_custom_domain.this : k => d.hostname }
}
