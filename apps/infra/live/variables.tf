variable "environment" {
  type = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environmentは\"staging\"・\"prod\"のいずれかにする。"
  }
}

variable "state_passphrase" {
  type      = string
  sensitive = true
}
