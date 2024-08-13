#!/usr/bin/python3
import re
import pyperclip
import beaupy

print("Digite o nome:")

name = input()

# remover caracteres especiais
name = name.translate({ord(c): "" for c in R"!@#$%^&*()[]{};:,./<>?\|`~-=_+"})

add_upper = lambda options: options + "".join([c.upper() for c in options])

# remover mais alguns
a_variations = "àâáã"
a_variations = add_upper(a_variations)
name = re.sub(fr"[{a_variations}]", 'a', name)

e_variations = "éêẽè"
e_variations = add_upper(e_variations)
name = re.sub(fr"[{e_variations}]", 'e', name)

i_variations = "íîĩ"
i_variations = add_upper(i_variations)
name = re.sub(fr"[{i_variations}]", 'i', name)

o_variations = "óõô"
o_variations = add_upper(o_variations)
name = re.sub(fr"[{o_variations}]", 'o', name)

u_variations = "úûũ"
u_variations = add_upper(u_variations)
name = re.sub(fr"[{u_variations}]", 'u', name)

c_variations = "ç"
c_variations = add_upper(c_variations)
name = re.sub(fr"[{c_variations}]", 'c', name)

print("Selecione o tipo da branch:")

branches_opts = [
    "feature",
    "fix",
    "hotfix"
]

opt = beaupy.select(options=branches_opts)

# simplify 'feature' to be 'feat'
if opt == "feature":
    opt = "feat"

name = opt + "/" + name.replace(" ", "-")

print("Nome formatado:")
print(name)

pyperclip.copy(name)

print("(copiado para o clipboard)")
