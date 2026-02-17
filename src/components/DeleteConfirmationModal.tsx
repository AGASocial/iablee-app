"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DeleteConfirmationModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    title: string;
    description: string;
    loading?: boolean;
}

export default function DeleteConfirmationModal({
    open,
    onClose,
    onConfirm,
    title,
    description,
    loading = false
}: DeleteConfirmationModalProps) {
    const t = useTranslations();

    return (
        <Dialog open={open} onOpenChange={(val) => !val && !loading && onClose()}>
            <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden border-0 shadow-xl">
                <div className="bg-white dark:bg-zinc-950 p-6">
                    <div className="flex flex-col items-center text-center gap-4 pt-4">
                        <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-2">
                            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-500" />
                        </div>
                        <DialogHeader>
                            <DialogTitle className="text-xl sm:text-2xl text-center">{title}</DialogTitle>
                            <DialogDescription className="text-center pt-2">
                                {description}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <DialogFooter className="mt-8 flex-col sm:flex-row gap-3 sm:gap-2">
                        <Button
                            variant="outline"
                            onClick={onClose}
                            disabled={loading}
                            className="w-full sm:w-auto mt-2 sm:mt-0"
                        >
                            {t('cancel')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={onConfirm}
                            disabled={loading}
                            className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white"
                        >
                            {loading ? (t('deleting') || 'Deleting...') : (t('delete') || 'Delete')}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}
