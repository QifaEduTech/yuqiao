$ErrorActionPreference = 'Stop'
$inputValue = [Console]::In.ReadToEnd()
$secureValue = ConvertTo-SecureString $inputValue
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureValue.Dispose() }
