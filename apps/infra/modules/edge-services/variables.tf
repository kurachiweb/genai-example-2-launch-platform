variable "account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "turnstile" {
  type = object({
    name    = string
    domains = list(string)
    mode    = string
  })

  validation {
    condition     = var.turnstile.mode == "invisible"
    error_message = "turnstile.modeは\"invisible\"にする。"
  }
}

variable "web_analytics_host" {
  type = string
}

variable "email_sending_domain" {
  type = string
}
