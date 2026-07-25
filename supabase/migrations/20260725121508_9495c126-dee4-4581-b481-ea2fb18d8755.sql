CREATE POLICY "Users can update their own card photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text);