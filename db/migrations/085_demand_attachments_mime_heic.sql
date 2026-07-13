-- Anexos do chat: libera os formatos que a UI já aceitava e o Storage recusava.
-- Sintoma: print tirado no iPhone (image/heic) e .zip no Windows
-- (application/x-zip-compressed) passavam pela validação da tela e quebravam no
-- upload com erro de mime — o cliente via "falha no upload" sem entender.
-- (Aplicada no remoto via Storage API; esta migration é o registro versionado.)

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
     'image/heic', 'image/heif', 'image/avif',        -- fotos de celular (iPhone/Android modernos)
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'text/plain', 'text/csv',
     'application/zip', 'application/x-zip-compressed'  -- x-zip-compressed = zip no Windows
   ]
 where id = 'demand-attachments';
